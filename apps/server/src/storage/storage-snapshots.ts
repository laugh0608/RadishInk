import {
  ArticleManifest,
  ArticleSnapshot,
  JsonValue,
  StorageError,
  StorageLimits,
  assertUuid,
  assertRevision,
  canonicalJson,
  decodeUtf8,
  metadataBytes,
  sha256,
  validateResources,
} from './storage-contract';
import { ArticleRow } from './storage-database';
import { StorageFiles } from './storage-files';

export const articleDirectory = (
  ownerId: string,
  articleId: string,
): string => {
  assertUuid(ownerId);
  assertUuid(articleId);
  return `users/${ownerId}/articles/${articleId}`;
};

export function snapshotDirectory(row: ArticleRow): string {
  assertUuid(row.generation);
  return `${articleDirectory(row.owner_id, row.id)}/generations/${row.generation}`;
}

export function logicalBytes(manifest: ArticleManifest): number {
  return (
    manifest.markdown.size +
    manifest.metadata.size +
    manifest.assets.reduce((sum, resource) => sum + resource.size, 0)
  );
}

export class SnapshotFiles {
  constructor(
    readonly files: StorageFiles,
    readonly limits: StorageLimits,
  ) {}

  manifest(row: ArticleRow): ArticleManifest {
    try {
      const bytes = this.files.read(
        `${snapshotDirectory(row)}/manifest.json`,
        1024 * 1024,
      );
      if (sha256(bytes) !== row.manifest_hash)
        throw new Error('manifest digest mismatch');
      const parsed: unknown = JSON.parse(decodeUtf8(bytes));
      if (!parsed || typeof parsed !== 'object')
        throw new Error('invalid manifest');
      const manifest = parsed as ArticleManifest;
      if (
        manifest.format !== 1 ||
        manifest.ownerId !== row.owner_id ||
        manifest.articleId !== row.id ||
        manifest.revision !== row.revision
      )
        throw new Error('manifest identity mismatch');
      assertRevision(manifest.revision);
      for (const [entry, maximum] of [
        [manifest.markdown, this.limits.markdownBytes],
        [manifest.metadata, this.limits.metadataBytes],
      ] as const) {
        if (
          !entry ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          entry.size > maximum ||
          !/^[0-9a-f]{64}$/.test(entry.sha256)
        )
          throw new Error('invalid content descriptor');
      }
      validateResources(manifest.assets, this.limits);
      if (logicalBytes(manifest) !== row.logical_bytes)
        throw new Error('logical size mismatch');
      return manifest;
    } catch (error) {
      throw new StorageError('corrupt', '文章提交清单损坏或不可读取', {
        cause: error,
      });
    }
  }

  read(row: ArticleRow): {
    snapshot: ArticleSnapshot;
    manifest: ArticleManifest;
  } {
    const manifest = this.manifest(row);
    const base = articleDirectory(row.owner_id, row.id);
    const directory = snapshotDirectory(row);
    try {
      const markdown = decodeUtf8(
        this.files.verify(
          `${directory}/index.md`,
          manifest.markdown.sha256,
          manifest.markdown.size,
        ),
      );
      const rawMetadata = this.files.verify(
        `${directory}/article.json`,
        manifest.metadata.sha256,
        manifest.metadata.size,
      );
      const metadata: unknown = JSON.parse(decodeUtf8(rawMetadata));
      metadataBytes(metadata, row.id, this.limits.metadataBytes);
      for (const asset of manifest.assets)
        this.files.verify(
          `${base}/objects/${asset.sha256}`,
          asset.sha256,
          asset.size,
        );
      return {
        manifest,
        snapshot: {
          articleId: row.id,
          revision: row.revision,
          markdown,
          metadata: metadata as { [key: string]: JsonValue },
          assets: manifest.assets,
        },
      };
    } catch (error) {
      throw new StorageError(
        'corrupt',
        '文章正文、元数据或资源完整性检查失败',
        { cause: error },
      );
    }
  }

  manifestBytes(manifest: ArticleManifest): Buffer {
    return Buffer.from(canonicalJson(manifest), 'utf8');
  }
}
