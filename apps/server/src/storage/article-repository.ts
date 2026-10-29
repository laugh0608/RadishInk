import { randomUUID } from 'node:crypto';
import {
  ArticleManifest,
  ArticleSnapshot,
  ArticleWrite,
  CommitReceipt,
  DEFAULT_STORAGE_LIMITS,
  ResourceInput,
  StorageError,
  StorageLimits,
  assertAssetPath,
  assertRevision,
  assertUuid,
  articleIndex,
  canonicalJson,
  decodeUtf8,
  metadataBytes,
  sha256,
  validateResources,
} from './storage-contract';
import { ArticleRow, StorageDatabase } from './storage-database';
import {
  SnapshotFiles,
  articleDirectory,
  logicalBytes,
} from './storage-snapshots';

export type CommitStage =
  | 'body-written'
  | 'objects-published'
  | 'snapshot-published'
  | 'transaction-written'
  | 'committed';
export interface RepositoryOptions {
  limits?: Partial<StorageLimits>;
  authorize?: () => void;
  /** 故障注入用于验证正式算法；常规实例不传入。 */
  checkpoint?: (stage: CommitStage) => void;
}
interface ReceiptRow {
  operation_id: string;
  article_id: string;
  request_digest: string;
  revision: number;
  kind: 'save' | 'delete';
}
interface UsageRow {
  articles: number;
  logical_bytes: number;
}

/** 本机文章仓储。调用者必须是可信身份模块，HTTP 调用必须提供事务内 authorize 复核。 */
export class ArticleRepository {
  readonly limits: StorageLimits;
  readonly snapshots: SnapshotFiles;
  private writing = false;

  constructor(
    readonly database: StorageDatabase,
    private readonly options: RepositoryOptions = {},
  ) {
    this.limits = { ...DEFAULT_STORAGE_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new StorageError('invalid', '存储限额无效');
    }
    this.snapshots = new SnapshotFiles(database.files, this.limits);
  }

  private row(
    ownerId: string,
    articleId: string,
    includeDeleted = false,
  ): ArticleRow | undefined {
    this.options.authorize?.();
    this.database.assertOwner(ownerId);
    assertUuid(articleId);
    return this.database.connection
      .prepare<
        [string, string, number],
        ArticleRow
      >('SELECT * FROM articles WHERE owner_id = ? AND id = ? AND (? = 1 OR deleted = 0)')
      .get(ownerId, articleId, includeDeleted ? 1 : 0);
  }

  read(ownerId: string, articleId: string): ArticleSnapshot {
    const row = this.row(ownerId, articleId);
    if (!row) throw new StorageError('not-found', '文章不存在或不可访问');
    return this.snapshots.read(row).snapshot;
  }

  readAsset(
    ownerId: string,
    articleId: string,
    path: string,
    revision: number,
  ): Buffer {
    assertRevision(revision);
    assertAssetPath(path);
    const row = this.row(ownerId, articleId);
    if (!row) throw new StorageError('not-found', '资源不存在或不可访问');
    if (row.revision !== revision)
      throw new StorageError('conflict', '文章版本变化，请重新读取完整快照');
    const asset = this.snapshots
      .manifest(row)
      .assets.find((item) => item.path === path);
    if (!asset) throw new StorageError('not-found', '资源不存在或不可访问');
    try {
      return this.database.files.verify(
        `${articleDirectory(ownerId, articleId)}/objects/${asset.sha256}`,
        asset.sha256,
        asset.size,
      );
    } catch (error) {
      throw new StorageError('corrupt', '已提交资源缺失、损坏或不可读取', {
        cause: error,
      });
    }
  }

  list(
    ownerId: string,
    limit = 50,
    afterId?: string,
  ): { id: string; title: string; savedAt: string; revision: number }[] {
    this.options.authorize?.();
    this.database.assertOwner(ownerId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new StorageError('invalid', '分页大小无效');
    if (afterId !== undefined) assertUuid(afterId);
    return this.database.connection
      .prepare<[string, string, number], ArticleRow>(
        'SELECT * FROM articles WHERE owner_id = ? AND deleted = 0 AND id > ? ORDER BY id LIMIT ?',
      )
      .all(ownerId, afterId ?? '', limit)
      .map((row) => ({
        id: row.id,
        title: row.title,
        savedAt: row.saved_at,
        revision: row.revision,
      }));
  }

  private receipt(
    ownerId: string,
    operationId: string,
    digest: string,
  ): CommitReceipt | undefined {
    const previous = this.database.connection
      .prepare<
        [string, string],
        ReceiptRow
      >('SELECT * FROM commit_receipts WHERE owner_id = ? AND operation_id = ?')
      .get(ownerId, operationId);
    if (!previous) return undefined;
    if (previous.request_digest !== digest)
      throw new StorageError('idempotency-mismatch', '操作 ID 已用于不同请求');
    const row = this.row(
      ownerId,
      previous.article_id,
      previous.kind === 'delete',
    );
    if (!row) throw new StorageError('not-found', '原操作的文章已不可访问');
    return {
      operationId: previous.operation_id,
      articleId: previous.article_id,
      committedRevision: previous.revision,
      kind: previous.kind,
    };
  }

  private target(
    ownerId: string,
    id: string,
    expected: number | null,
  ): ArticleRow | undefined {
    this.options.authorize?.();
    this.database.assertOwner(ownerId);
    const row = this.database.connection
      .prepare<[string], ArticleRow>('SELECT * FROM articles WHERE id = ?')
      .get(id);
    if (row && (row.owner_id !== ownerId || row.deleted))
      throw new StorageError('not-found', '文章不存在或不可访问');
    if (!row && expected !== null)
      throw new StorageError('not-found', '文章不存在或不可访问');
    if ((row?.revision ?? null) !== expected)
      throw new StorageError('conflict', '文章版本已变化，保留当前编辑');
    return row;
  }

  private assertLogicalQuota(
    ownerId: string,
    old: ArticleRow | undefined,
    bytes: number,
  ): void {
    const usage = this.database.connection
      .prepare<
        [string],
        UsageRow
      >('SELECT articles, logical_bytes FROM owner_usage WHERE owner_id = ?')
      .get(ownerId);
    if (!usage) throw new StorageError('corrupt', '缺少所有者用量记录');
    if (
      usage.articles + (old ? 0 : 1) > this.limits.articlesPerOwner ||
      usage.logical_bytes - (old?.logical_bytes ?? 0) + bytes >
        this.limits.ownerLogicalBytes
    ) {
      throw new StorageError('capacity', '工作区文章数量或逻辑容量超限');
    }
  }

  private assertPhysicalQuota(ownerId: string, additional: number): void {
    const files = this.database.files;
    const used = [
      ...files.inventory(`users/${ownerId}`),
      ...files.inventory(`staging/${ownerId}`),
    ].reduce((sum, file) => sum + file.size, 0);
    if (used + additional > this.limits.ownerPhysicalBytes)
      throw new StorageError(
        'capacity',
        '工作区物理容量超限，请停写并执行维护检查',
      );
    files.assertFreeSpace(additional, this.limits.minimumFreeBytes);
  }

  private validateAssets(
    assets: ResourceInput[],
    previous: ArticleManifest | undefined,
  ): void {
    const before = new Map(
      previous?.assets.map((asset) => [asset.path, asset]),
    );
    const after = new Map(assets.map((asset) => [asset.path, asset]));
    for (const old of before.values()) {
      const next = after.get(old.path);
      if (!next || old.sha256 !== next.sha256 || old.size !== next.size)
        throw new StorageError('invalid', '已保存资源不能隐式删除或覆盖');
    }
    for (const asset of assets) {
      if (asset.bytes) {
        if (
          asset.bytes.length !== asset.size ||
          sha256(asset.bytes) !== asset.sha256
        )
          throw new StorageError('invalid', '新资源字节与清单不符');
      } else {
        const old = before.get(asset.path);
        if (!old || old.sha256 !== asset.sha256 || old.size !== asset.size)
          throw new StorageError('invalid', '资源引用不属于本文章当前快照');
      }
    }
  }

  commit(input: ArticleWrite): CommitReceipt {
    if (this.writing)
      throw new StorageError('locked', '该仓储已有进行中的写入');
    this.writing = true;
    try {
      return this.save(input);
    } finally {
      this.writing = false;
    }
  }

  private save(input: ArticleWrite): CommitReceipt {
    const { ownerId, articleId, operationId, expectedRevision } = input;
    this.options.authorize?.();
    this.database.assertOwner(ownerId);
    assertUuid(articleId);
    assertUuid(operationId);
    assertRevision(expectedRevision);
    if (typeof input.markdown !== 'string')
      throw new StorageError('invalid', '正文不是字符串');
    const markdown = Buffer.from(input.markdown, 'utf8');
    if (decodeUtf8(markdown) !== input.markdown)
      throw new StorageError('invalid', '正文含无效 Unicode 字符');
    if (markdown.length > this.limits.markdownBytes)
      throw new StorageError('capacity', '正文超出限制');
    const metadata = metadataBytes(
      input.metadata,
      articleId,
      this.limits.metadataBytes,
    );
    const savedMetadata = JSON.parse(
      decodeUtf8(metadata),
    ) as ArticleWrite['metadata'];
    const index = articleIndex(savedMetadata);
    validateResources(input.assets, this.limits);
    for (const asset of input.assets) {
      if (asset.bytes !== undefined && !(asset.bytes instanceof Uint8Array)) {
        throw new StorageError('invalid', '资源内容必须是字节数组');
      }
    }
    const assets = input.assets
      .map((asset) => ({
        path: asset.path,
        size: asset.size,
        sha256: asset.sha256,
        ...(asset.bytes !== undefined
          ? { bytes: Buffer.from(asset.bytes) }
          : {}),
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const manifest: ArticleManifest = {
      format: 1,
      ownerId,
      articleId,
      revision: expectedRevision === null ? 0 : expectedRevision + 1,
      markdown: { sha256: sha256(markdown), size: markdown.length },
      metadata: { sha256: sha256(metadata), size: metadata.length },
      assets: assets.map(({ path, size, sha256: digest }) => ({
        path,
        size,
        sha256: digest,
      })),
    };
    if (
      markdown.length +
        assets.reduce((sum, resource) => sum + resource.size, 0) >
      this.limits.articleBytes
    )
      throw new StorageError('capacity', '文章总量超出限制');
    // bytes 的有无是传输选择；摘要由完整逻辑内容决定。
    const requestDigest = sha256(
      canonicalJson({
        protocol: 1,
        method: 'save',
        articleId,
        expectedRevision,
        markdown: manifest.markdown,
        metadata: manifest.metadata,
        assets: manifest.assets,
      }),
    );
    // 即使是重试，也校验随请求提供的新字节，不能只比较客户端声明的摘要。
    for (const asset of assets) {
      if (
        asset.bytes &&
        (asset.bytes.length !== asset.size ||
          sha256(asset.bytes) !== asset.sha256)
      )
        throw new StorageError('invalid', '新资源字节与清单不符');
    }
    const replay = this.receipt(ownerId, operationId, requestDigest);
    if (replay) return replay;
    const old = this.target(ownerId, articleId, expectedRevision);
    const previous = old ? this.snapshots.read(old).manifest : undefined;
    this.validateAssets(assets, previous);
    this.assertLogicalQuota(ownerId, old, logicalBytes(manifest));
    const manifestBytes = this.snapshots.manifestBytes(manifest);
    // 保守预留所有传入资源，避免暂存与最终对象短时共存超出容量。
    this.assertPhysicalQuota(
      ownerId,
      markdown.length +
        metadata.length +
        manifestBytes.length +
        assets.reduce((sum, asset) => sum + (asset.bytes?.length ?? 0), 0),
    );
    const files = this.database.files;
    const base = articleDirectory(ownerId, articleId);
    const generation = randomUUID();
    const stage = `staging/${ownerId}/${generation}`;
    files.mkdir(stage);
    files.writeNew(`${stage}/index.md`, markdown);
    this.options.checkpoint?.('body-written');
    files.writeNew(`${stage}/article.json`, metadata);
    files.mkdir(`${base}/objects`);
    files.mkdir(`${base}/generations`);
    for (const asset of assets) {
      const object = `${base}/objects/${asset.sha256}`;
      if (files.exists(object)) files.verify(object, asset.sha256, asset.size);
      else {
        if (!asset.bytes) throw new StorageError('corrupt', '既有资源对象缺失');
        const temporary = `${stage}/${asset.sha256}.object`;
        files.writeNew(temporary, asset.bytes);
        files.publishObject(temporary, object, asset.sha256, asset.size);
      }
    }
    this.options.checkpoint?.('objects-published');
    files.writeNew(`${stage}/manifest.json`, manifestBytes);
    files.publishDirectory(stage, `${base}/generations/${generation}`);
    this.options.checkpoint?.('snapshot-published');
    this.snapshots.read({
      id: articleId,
      owner_id: ownerId,
      revision: manifest.revision,
      generation,
      manifest_hash: sha256(manifestBytes),
      logical_bytes: logicalBytes(manifest),
      title: index.title,
      saved_at: index.savedAt,
      deleted: 0,
    });
    const result = this.database.connection
      .transaction(() => {
        this.options.authorize?.();
        this.database.assertOwner(ownerId);
        const alreadyCommitted = this.receipt(
          ownerId,
          operationId,
          requestDigest,
        );
        if (alreadyCommitted) return alreadyCommitted;
        const actual = this.target(ownerId, articleId, expectedRevision);
        // 文件完成后仍复核权限、版本和用量；不会用最新版本掩盖冲突。
        this.assertLogicalQuota(ownerId, actual, logicalBytes(manifest));
        this.database.connection
          .prepare(
            `INSERT INTO articles
        (id, owner_id, revision, generation, manifest_hash, logical_bytes, title, saved_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, generation=excluded.generation,
        manifest_hash=excluded.manifest_hash, logical_bytes=excluded.logical_bytes,
        title=excluded.title, saved_at=excluded.saved_at`,
          )
          .run(
            articleId,
            ownerId,
            manifest.revision,
            generation,
            sha256(manifestBytes),
            logicalBytes(manifest),
            index.title,
            index.savedAt,
          );
        this.database.connection
          .prepare(
            'UPDATE owner_usage SET articles = articles + ?, logical_bytes = logical_bytes + ? WHERE owner_id = ?',
          )
          .run(
            actual ? 0 : 1,
            logicalBytes(manifest) - (actual?.logical_bytes ?? 0),
            ownerId,
          );
        this.database.connection
          .prepare('INSERT INTO commit_receipts VALUES (?, ?, ?, ?, ?, ?)')
          .run(
            ownerId,
            operationId,
            requestDigest,
            articleId,
            manifest.revision,
            'save',
          );
        this.options.checkpoint?.('transaction-written');
        return {
          operationId,
          articleId,
          committedRevision: manifest.revision,
          kind: 'save' as const,
        };
      })
      .immediate();
    this.options.checkpoint?.('committed');
    return result;
  }

  delete(
    ownerId: string,
    articleId: string,
    expectedRevision: number,
    operationId: string,
  ): CommitReceipt {
    this.options.authorize?.();
    this.database.assertOwner(ownerId);
    assertUuid(articleId);
    assertUuid(operationId);
    assertRevision(expectedRevision);
    const digest = sha256(
      canonicalJson({
        protocol: 1,
        method: 'delete',
        articleId,
        expectedRevision,
      }),
    );
    const previous = this.receipt(ownerId, operationId, digest);
    if (previous) return previous;
    const before = this.target(ownerId, articleId, expectedRevision);
    if (!before) throw new StorageError('not-found', '文章不存在或不可访问');
    // 完整文件校验在短事务之外；事务内重新裁决身份与版本。
    this.snapshots.read(before);
    return this.database.connection
      .transaction(() => {
        this.options.authorize?.();
        this.database.assertOwner(ownerId);
        const replay = this.receipt(ownerId, operationId, digest);
        if (replay) return replay;
        const row = this.target(ownerId, articleId, expectedRevision);
        if (!row) throw new StorageError('not-found', '文章不存在或不可访问');
        this.database.connection
          .prepare(
            'UPDATE articles SET deleted = 1 WHERE owner_id = ? AND id = ?',
          )
          .run(ownerId, articleId);
        this.database.connection
          .prepare(
            'UPDATE owner_usage SET articles = articles - 1, logical_bytes = logical_bytes - ? WHERE owner_id = ?',
          )
          .run(row.logical_bytes, ownerId);
        this.database.connection
          .prepare('INSERT INTO commit_receipts VALUES (?, ?, ?, ?, ?, ?)')
          .run(ownerId, operationId, digest, articleId, row.revision, 'delete');
        return {
          operationId,
          articleId,
          committedRevision: row.revision,
          kind: 'delete' as const,
        };
      })
      .immediate();
  }
}
