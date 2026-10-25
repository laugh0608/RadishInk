import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { ArticleRepository, CommitStage } from './article-repository';
import { ArticleWrite, StorageError, sha256 } from './storage-contract';
import { SHARED_OWNER, StorageDatabase } from './storage-database';
import { StorageMaintenance } from './storage-maintenance';
import { runStorageCommand } from './storage-cli';

const source = '\uFEFF---\r\nunknown: keep\r\n---\r\n# 合成文章\r\n';
const bytes = Buffer.from([0, 255, 13, 10, 42]);
const owner = randomUUID();
const article = randomUUID();

function draft(overrides: Partial<ArticleWrite> = {}): ArticleWrite {
  return {
    ownerId: owner,
    articleId: article,
    operationId: randomUUID(),
    expectedRevision: null,
    markdown: source,
    metadata: {
      id: article,
      savedAt: '2026-10-25T00:00:00.000Z',
      theme: 'default',
      themeName: '默认',
      customCSS: '',
      title: '合成文章',
      unknown: { preserved: true },
    },
    assets: [
      {
        path: 'asset/图片.png',
        bytes,
        sha256: sha256(bytes),
        size: bytes.length,
      },
    ],
    ...overrides,
  };
}

describe('正式文章仓储', () => {
  let directory: string;
  let db: StorageDatabase;
  let store: ArticleRepository;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'radishink-server-store-'));
    db = new StorageDatabase({
      directory,
      mode: 'accounts',
      initialize: true,
      busyTimeoutMs: 20,
    });
    db.registerOwner(owner);
    store = new ArticleRepository(db);
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('正文、完整元数据和原始资源在重开后保持', () => {
    const input = draft();
    expect(store.commit(input).committedRevision).toBe(0);
    db.close();
    db = new StorageDatabase({ directory, mode: 'accounts' });
    store = new ArticleRepository(db);
    const read = store.read(owner, article);
    expect(read.markdown).toBe(source);
    expect(read.metadata).toEqual(input.metadata);
    expect(store.readAsset(owner, article, 'asset/图片.png', 0)).toEqual(bytes);
    expect(new StorageMaintenance(store).inspect().articles).toBe(1);
  });

  it('未知字段、对象属性顺序和资源传输方式不影响相同提交的重试', () => {
    const input = draft();
    store.commit(input);
    const replay = {
      ...input,
      metadata: Object.fromEntries(Object.entries(input.metadata).reverse()),
      assets: input.assets.map(({ path, size, sha256: digest }) => ({
        path,
        size,
        sha256: digest,
      })),
    };
    expect(store.commit(replay).committedRevision).toBe(0);
    expect(store.list(owner)).toHaveLength(1);
    expect(() => store.commit({ ...input, markdown: 'different' })).toThrow(
      expect.objectContaining({ code: 'idempotency-mismatch' }) as Error,
    );
  });

  it('旧操作重试不回退最新版本，异值新字节仍会失败', () => {
    const first = draft();
    store.commit(first);
    store.commit(draft({ expectedRevision: 0, markdown: 'updated' }));
    expect(store.commit(first).committedRevision).toBe(0);
    expect(store.read(owner, article).markdown).toBe('updated');
    expect(() =>
      store.commit({
        ...first,
        assets: [{ ...first.assets[0], bytes: Buffer.from('bad') }],
      }),
    ).toThrow(StorageError);
  });

  it('已读版本冲突保留先提交的正文与资源', () => {
    store.commit(draft());
    store.commit(draft({ expectedRevision: 0, markdown: 'winner' }));
    expect(() =>
      store.commit(draft({ expectedRevision: 0, markdown: 'late' })),
    ).toThrow(expect.objectContaining({ code: 'conflict' }) as Error);
    expect(store.read(owner, article).markdown).toBe('winner');
    expect(() => store.readAsset(owner, article, 'asset/图片.png', 0)).toThrow(
      StorageError,
    );
  });

  it('文件发布后再次检查版本，拒绝插入的竞争提交', () => {
    store.commit(draft());
    const late = new ArticleRepository(db, {
      checkpoint(stage) {
        if (stage === 'snapshot-published')
          store.commit(draft({ expectedRevision: 0, markdown: 'winner' }));
      },
    });
    expect(() =>
      late.commit(draft({ expectedRevision: 0, markdown: 'late' })),
    ).toThrow(expect.objectContaining({ code: 'conflict' }) as Error);
    expect(store.read(owner, article).markdown).toBe('winner');
  });

  it('其他用户不能枚举、读取、读图、保存或删除已知文章', () => {
    const another = randomUUID();
    db.registerOwner(another);
    store.commit(draft());
    expect(store.list(another)).toEqual([]);
    for (const operation of [
      () => store.read(another, article),
      () => store.readAsset(another, article, 'asset/图片.png', 0),
      () => store.commit(draft({ ownerId: another, expectedRevision: 0 })),
      () => store.delete(another, article, 0, randomUUID()),
    ])
      expect(operation).toThrow(
        expect.objectContaining({ code: 'not-found' }) as Error,
      );
    expect(store.read(owner, article).revision).toBe(0);
  });

  it('不存在与他人的文章更新 / 删除使用相同不可访问错误', () => {
    const missing = randomUUID();
    expect(() =>
      store.commit(
        draft({
          articleId: missing,
          metadata: { ...draft().metadata, id: missing },
          expectedRevision: 0,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'not-found' }) as Error);
    expect(() => store.delete(owner, missing, 0, randomUUID())).toThrow(
      expect.objectContaining({ code: 'not-found' }) as Error,
    );
  });

  it('文件发布后账号被禁用，事务不会发布文章', () => {
    store.commit(draft());
    const disabled = new ArticleRepository(db, {
      checkpoint(stage) {
        if (stage === 'snapshot-published')
          db.connection
            .prepare('UPDATE users SET enabled = 0 WHERE id = ?')
            .run(owner);
      },
    });
    expect(() => disabled.commit(draft({ expectedRevision: 0 }))).toThrow(
      expect.objectContaining({ code: 'not-found' }) as Error,
    );
    expect(
      db.connection
        .prepare<
          [string],
          { revision: number }
        >('SELECT revision FROM articles WHERE id = ?')
        .get(article)?.revision,
    ).toBe(0);
    expect(() => store.read(owner, article)).toThrow(StorageError);
  });

  it('不按猜到的摘要引用另一文章资源，也不隐式删改旧资源', () => {
    store.commit(draft());
    const otherArticle = randomUUID();
    const referenced = [
      { path: 'asset/图片.png', sha256: sha256(bytes), size: bytes.length },
    ];
    expect(() =>
      store.commit(
        draft({
          articleId: otherArticle,
          metadata: { ...draft().metadata, id: otherArticle },
          assets: referenced,
        }),
      ),
    ).toThrow(StorageError);
    expect(() =>
      store.commit(draft({ expectedRevision: 0, assets: [] })),
    ).toThrow(StorageError);
    const changed = Buffer.from('new image');
    expect(() =>
      store.commit(
        draft({
          expectedRevision: 0,
          assets: [
            {
              path: 'asset/图片.png',
              bytes: changed,
              size: changed.length,
              sha256: sha256(changed),
            },
          ],
        }),
      ),
    ).toThrow(StorageError);
    store.commit(
      draft({
        expectedRevision: 0,
        assets: referenced,
        markdown: 'reference removed from text',
      }),
    );
    expect(store.readAsset(owner, article, 'asset/图片.png', 1)).toEqual(bytes);
  });

  it.each([
    '../a',
    'asset/../a',
    'asset/%2e%2e',
    'asset/a/b',
    'asset/.hidden',
    'asset/CON.png',
    'asset/a\\b',
    'asset/e\u0301.png',
  ])('拒绝非法资源路径 %s', (path) => {
    expect(() =>
      store.commit(
        draft({
          assets: [{ path, bytes, sha256: sha256(bytes), size: bytes.length }],
        }),
      ),
    ).toThrow(StorageError);
    expect(store.list(owner)).toHaveLength(0);
  });

  it('拒绝资源大小写冲突、损坏摘要、无效正文与非 JSON 元数据', () => {
    const resource = { bytes, sha256: sha256(bytes), size: bytes.length };
    expect(() =>
      store.commit(
        draft({
          assets: [
            { ...resource, path: 'asset/A.png' },
            { ...resource, path: 'asset/a.png' },
          ],
        }),
      ),
    ).toThrow(StorageError);
    expect(() =>
      store.commit(
        draft({
          assets: [
            { ...resource, path: 'asset/a.png', sha256: '0'.repeat(64) },
          ],
        }),
      ),
    ).toThrow(StorageError);
    expect(() => store.commit(draft({ markdown: '\ud800' }))).toThrow(
      StorageError,
    );
    expect(() =>
      store.commit(
        draft({ metadata: { ...draft().metadata, number: Infinity } }),
      ),
    ).toThrow(StorageError);
  });

  it('数量、逻辑容量和暂存 / 历史物理容量都阻止新写入', () => {
    expect(() =>
      new ArticleRepository(db, { limits: { ownerLogicalBytes: 1 } }).commit(
        draft(),
      ),
    ).toThrow(expect.objectContaining({ code: 'capacity' }) as Error);
    expect(() =>
      new ArticleRepository(db, { limits: { ownerPhysicalBytes: 1 } }).commit(
        draft(),
      ),
    ).toThrow(StorageError);
    store.commit(draft());
    const id = randomUUID();
    const bounded = new ArticleRepository(db, {
      limits: { articlesPerOwner: 1 },
    });
    expect(() =>
      bounded.commit(
        draft({ articleId: id, metadata: { ...draft().metadata, id } }),
      ),
    ).toThrow(StorageError);
    bounded.commit(draft({ expectedRevision: 0 }));
    const physical = new StorageMaintenance(store).inspect().physicalBytes;
    const physicalBound = new ArticleRepository(db, {
      limits: { ownerPhysicalBytes: physical },
    });
    expect(() => physicalBound.commit(draft({ expectedRevision: 1 }))).toThrow(
      StorageError,
    );
  });

  it.each([
    'body-written',
    'objects-published',
    'snapshot-published',
    'transaction-written',
  ] as CommitStage[])('注入 %s 失败保留旧版本和原错误', (stage) => {
    store.commit(draft());
    const fault = Object.assign(new Error('synthetic ENOSPC'), {
      code: 'ENOSPC',
    });
    const failing = new ArticleRepository(db, {
      checkpoint(current) {
        if (current === stage) throw fault;
      },
    });
    expect(() =>
      failing.commit(draft({ expectedRevision: 0, markdown: 'not saved' })),
    ).toThrow(fault);
    expect(store.read(owner, article).markdown).toBe(source);
    expect(new StorageMaintenance(store).inspect().articles).toBe(1);
  });

  it('实际 SQLite 写锁繁忙不伪造成功', () => {
    store.commit(draft());
    const blocker = new Database(join(directory, 'metadata.sqlite'));
    try {
      blocker.exec('BEGIN IMMEDIATE');
      expect(() => store.commit(draft({ expectedRevision: 0 }))).toThrow(
        /locked/,
      );
      expect(store.read(owner, article).revision).toBe(0);
    } finally {
      blocker.exec('ROLLBACK');
      blocker.close();
    }
  });

  it('删除即不可见、幂等、留墓碑且不能用旧保存回执复活', () => {
    const input = draft();
    store.commit(input);
    const operation = randomUUID();
    store.delete(owner, article, 0, operation);
    expect(store.delete(owner, article, 0, operation).kind).toBe('delete');
    expect(store.list(owner)).toEqual([]);
    expect(() => store.read(owner, article)).toThrow(StorageError);
    expect(() => store.readAsset(owner, article, 'asset/图片.png', 0)).toThrow(
      StorageError,
    );
    expect(() => store.commit(input)).toThrow(StorageError);
    expect(() => store.commit(draft())).toThrow(StorageError);
    const maintenance = new StorageMaintenance(store);
    const report = maintenance.inspect();
    expect(report.reclaimableBytes).toBe(report.physicalBytes);
    maintenance.cleanup(report.planDigest);
    expect(store.delete(owner, article, 0, operation).kind).toBe('delete');
    expect(() => store.commit(draft())).toThrow(StorageError);
  });

  it('清理只删除预览中非当前文件，预览变化和未知文件受保护', () => {
    store.commit(draft());
    store.commit(draft({ expectedRevision: 0, markdown: 'latest' }));
    const maintenance = new StorageMaintenance(store);
    const plan = maintenance.inspect();
    expect(plan.candidates.length).toBeGreaterThan(0);
    writeFileSync(join(directory, 'users', owner, 'unknown.txt'), 'keep');
    expect(() => maintenance.cleanup(plan.planDigest)).toThrow(StorageError);
    const next = maintenance.inspect();
    expect(next.unknownPaths).toContain(`users/${owner}/unknown.txt`);
    maintenance.cleanup(next.planDigest);
    expect(store.read(owner, article).markdown).toBe('latest');
    expect(store.readAsset(owner, article, 'asset/图片.png', 1)).toEqual(bytes);
    expect(
      readFileSync(join(directory, 'users', owner, 'unknown.txt'), 'utf8'),
    ).toBe('keep');
  });

  it('已提交资源损坏或符号链接使读取与维护停止', () => {
    store.commit(draft());
    const path = join(
      directory,
      'users',
      owner,
      'articles',
      article,
      'objects',
      sha256(bytes),
    );
    writeFileSync(path, 'corrupt');
    expect(() => store.read(owner, article)).toThrow(StorageError);
    expect(() => new StorageMaintenance(store).inspect()).toThrow(StorageError);
    writeFileSync(path, bytes);
    symlinkSync(path, join(directory, 'users', owner, 'link'));
    expect(() => new StorageMaintenance(store).inspect()).toThrow(StorageError);
  });

  it('仅重建派生索引，不提升孤儿版本', () => {
    store.commit(draft());
    const orphan = new ArticleRepository(db, {
      checkpoint(stage) {
        if (stage === 'snapshot-published') throw new Error('orphan');
      },
    });
    expect(() =>
      orphan.commit(draft({ expectedRevision: 0, markdown: 'not current' })),
    ).toThrow('orphan');
    db.connection.prepare('UPDATE owner_usage SET logical_bytes = 0').run();
    db.connection.prepare("UPDATE articles SET title = 'wrong'").run();
    const maintenance = new StorageMaintenance(store);
    expect(() => maintenance.inspect()).toThrow(StorageError);
    maintenance.rebuildDerivedIndexes();
    expect(maintenance.inspect().articles).toBe(1);
    expect(store.list(owner)[0].title).toBe('合成文章');
    expect(store.read(owner, article).markdown).toBe(source);
  });

  it('卷锁拒绝第二实例，正常关闭后可重开', () => {
    expect(() => new StorageDatabase({ directory, mode: 'accounts' })).toThrow(
      expect.objectContaining({ code: 'locked' }) as Error,
    );
    db.close();
    db = new StorageDatabase({ directory, mode: 'accounts' });
    expect(db.deployment.accountMode).toBe('accounts');
  });

  it('实际 schema 被修改时拒绝启动，即使版本与迁移摘要未变', () => {
    db.connection.exec('DROP INDEX article_owner_list');
    db.close();
    expect(() => new StorageDatabase({ directory, mode: 'accounts' })).toThrow(
      expect.objectContaining({ code: 'schema-incompatible' }) as Error,
    );
  });

  it('调用时捕获元数据与资源字节，晚到修改不污染正文索引', () => {
    const input = draft({
      assets: [
        {
          path: 'asset/a.png',
          bytes: Buffer.from(bytes),
          sha256: sha256(bytes),
          size: bytes.length,
        },
      ],
    });
    const capturing = new ArticleRepository(db, {
      checkpoint(stage) {
        if (stage === 'body-written') {
          input.metadata.title = 'late mutation';
          input.assets[0].bytes[0] = 42;
        }
      },
    });
    capturing.commit(input);
    expect(store.read(owner, article).metadata.title).toBe('合成文章');
    expect(store.list(owner)[0].title).toBe('合成文章');
    expect(store.readAsset(owner, article, 'asset/a.png', 0)).toEqual(bytes);
    expect(new StorageMaintenance(store).inspect().articles).toBe(1);
  });

  it.each([
    'body-written',
    'objects-published',
    'snapshot-published',
    'transaction-written',
  ] as CommitStage[])(
    '首次创建在 %s 失败后不出现半篇文章，可同 ID 重试',
    (stage) => {
      const request = draft();
      const failing = new ArticleRepository(db, {
        checkpoint(current) {
          if (current === stage) throw new Error('interrupted create');
        },
      });
      expect(() => failing.commit(request)).toThrow('interrupted create');
      expect(store.list(owner)).toEqual([]);
      expect(() => store.read(owner, article)).toThrow(StorageError);
      expect(new StorageMaintenance(store).inspect().articles).toBe(0);
      expect(store.commit(request).committedRevision).toBe(0);
      expect(store.readAsset(owner, article, 'asset/图片.png', 0)).toEqual(
        bytes,
      );
    },
  );

  it('显式初始化也不能在数据库丢失后认领遗留文章', () => {
    store.commit(draft());
    db.close();
    rmSync(join(directory, 'metadata.sqlite'));
    expect(
      () =>
        new StorageDatabase({ directory, mode: 'accounts', initialize: true }),
    ).toThrow(expect.objectContaining({ code: 'corrupt' }) as Error);
    expect(
      readFileSync(
        join(
          directory,
          'users',
          owner,
          'articles',
          article,
          'objects',
          sha256(bytes),
        ),
      ),
    ).toEqual(bytes);
  });

  it('拒绝账号模式变化与未来 schema，不清空已有文章', () => {
    store.commit(draft());
    db.close();
    expect(() => new StorageDatabase({ directory, mode: 'shared' })).toThrow(
      expect.objectContaining({ code: 'mode-mismatch' }) as Error,
    );
    db = new StorageDatabase({ directory, mode: 'accounts' });
    db.connection.pragma('user_version = 99');
    db.close();
    expect(() => new StorageDatabase({ directory, mode: 'accounts' })).toThrow(
      expect.objectContaining({ code: 'schema-incompatible' }) as Error,
    );
    const raw = new Database(join(directory, 'metadata.sqlite'));
    expect(raw.prepare('SELECT * FROM articles').all()).toHaveLength(1);
    raw.close();
  });

  it('迁移摘要漂移拒绝启动；现有模式不会被 initialize 覆盖', () => {
    db.connection
      .prepare("UPDATE schema_migrations SET digest = 'tampered'")
      .run();
    db.close();
    expect(
      () =>
        new StorageDatabase({ directory, mode: 'accounts', initialize: true }),
    ).toThrow(
      expect.objectContaining({ code: 'schema-incompatible' }) as Error,
    );
  });
});

describe('本机维护入口与真实进程中断', () => {
  let temporary: string;
  beforeEach(() => {
    temporary = mkdtempSync(join(tmpdir(), 'radishink-server-process-'));
  });
  afterEach(() => {
    rmSync(temporary, { recursive: true, force: true });
  });

  it('新共享库初始化、重开检查与参数失败', () => {
    const directory = join(temporary, 'data');
    expect(
      runStorageCommand(['init', '--data-dir', directory, '--mode', 'shared']),
    ).toEqual(expect.objectContaining({ articles: 0 }));
    expect(
      runStorageCommand(['check', '--data-dir', directory, '--mode', 'shared']),
    ).toEqual(expect.objectContaining({ articles: 0 }));
    expect(() =>
      runStorageCommand([
        'cleanup',
        '--data-dir',
        directory,
        '--mode',
        'shared',
        '--apply',
      ]),
    ).toThrow(StorageError);
    const db = new StorageDatabase({ directory, mode: 'shared' });
    expect(() => db.assertOwner(SHARED_OWNER)).not.toThrow();
    expect(() => db.registerOwner(randomUUID())).toThrow(StorageError);
    db.close();
  });

  it('数据库缺失时拒绝认领遗留文件，不初始化陌生目录', () => {
    writeFileSync(join(temporary, 'keep.md'), source);
    expect(
      () =>
        new StorageDatabase({
          directory: temporary,
          mode: 'accounts',
          initialize: true,
        }),
    ).toThrow(StorageError);
    expect(readFileSync(join(temporary, 'keep.md'), 'utf8')).toBe(source);
  });

  it.each([
    'body-written',
    'objects-published',
    'snapshot-published',
    'transaction-written',
    'committed',
  ] as CommitStage[])('SIGKILL %s 后真实驱动重开并重试', (stage) => {
    const directory = join(temporary, 'data');
    let db = new StorageDatabase({
      directory,
      mode: 'accounts',
      initialize: true,
    });
    db.registerOwner(owner);
    let store = new ArticleRepository(db);
    store.commit(draft());
    const operationId = randomUUID();
    const request = draft({
      operationId,
      expectedRevision: 0,
      markdown: 'after crash',
    });
    const fixture = join(temporary, 'request.json');
    writeFileSync(
      fixture,
      JSON.stringify({
        ...request,
        assets: request.assets.map(({ path, size, sha256: digest }) => ({
          path,
          size,
          sha256: digest,
        })),
      }),
    );
    db.close();
    const child = spawnSync(
      process.execPath,
      [
        join(__dirname, '../../test/storage-crash-child.cjs'),
        directory,
        fixture,
        stage,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    expect({ signal: child.signal, stderr: child.stderr }).toEqual({
      signal: 'SIGKILL',
      stderr: '',
    });
    db = new StorageDatabase({ directory, mode: 'accounts' });
    try {
      store = new ArticleRepository(db);
      const current = store.read(owner, article);
      expect(current.revision).toBe(stage === 'committed' ? 1 : 0);
      expect(current.markdown).toBe(
        stage === 'committed' ? 'after crash' : source,
      );
      expect(store.commit(request).committedRevision).toBe(1);
      expect(store.readAsset(owner, article, 'asset/图片.png', 1)).toEqual(
        bytes,
      );
      expect(new StorageMaintenance(store).inspect().articles).toBe(1);
    } finally {
      db.close();
    }
  });
});
