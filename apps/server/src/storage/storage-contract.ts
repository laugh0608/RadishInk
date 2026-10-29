import { createHash } from 'node:crypto';

export type StorageErrorCode =
  | 'invalid'
  | 'not-found'
  | 'conflict'
  | 'idempotency-mismatch'
  | 'capacity'
  | 'corrupt'
  | 'locked'
  | 'schema-incompatible'
  | 'mode-mismatch';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ResourceDescriptor {
  path: string;
  sha256: string;
  size: number;
}

export interface ResourceInput extends ResourceDescriptor {
  /** 缺省仅能引用本文章当前已提交清单中的相同资源。 */
  bytes?: Uint8Array;
}

export interface ArticleWrite {
  ownerId: string;
  articleId: string;
  operationId: string;
  expectedRevision: number | null;
  markdown: string;
  metadata: { [key: string]: JsonValue };
  assets: ResourceInput[];
}

export interface ArticleManifest {
  format: 1;
  ownerId: string;
  articleId: string;
  revision: number;
  markdown: { sha256: string; size: number };
  metadata: { sha256: string; size: number };
  assets: ResourceDescriptor[];
}

export interface ArticleSnapshot {
  articleId: string;
  revision: number;
  markdown: string;
  metadata: { [key: string]: JsonValue };
  assets: ResourceDescriptor[];
}

export interface CommitReceipt {
  operationId: string;
  articleId: string;
  committedRevision: number;
  kind: 'save' | 'delete';
}

export interface StorageLimits {
  markdownBytes: number;
  metadataBytes: number;
  assetBytes: number;
  assets: number;
  articleBytes: number;
  articlesPerOwner: number;
  ownerLogicalBytes: number;
  ownerPhysicalBytes: number;
  minimumFreeBytes: number;
}

const MiB = 1024 * 1024;
export const DEFAULT_STORAGE_LIMITS: Readonly<StorageLimits> = Object.freeze({
  markdownBytes: 5 * MiB,
  metadataBytes: MiB,
  assetBytes: 10 * MiB,
  assets: 125,
  articleBytes: 64 * MiB,
  articlesPerOwner: 1000,
  ownerLogicalBytes: 1024 * MiB,
  ownerPhysicalBytes: 2048 * MiB,
  minimumFreeBytes: 16 * MiB,
});

export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertUuid(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new StorageError('invalid', '身份必须是规范的小写 UUID v4');
  }
}

export function assertRevision(value: number | null): void {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) ||
      value < 0 ||
      value >= Number.MAX_SAFE_INTEGER)
  ) {
    throw new StorageError('invalid', '文章版本无效');
  }
}

export function assertAssetPath(path: string): void {
  const parts = path.split('/');
  const name = parts[1];
  if (
    parts.length !== 2 ||
    parts[0] !== 'asset' ||
    !name ||
    name.length > 100 ||
    name !== name.normalize('NFC') ||
    /[\\/%:*?"<>|]/.test(name) ||
    /[. ]$/.test(name) ||
    name.startsWith('.') ||
    Array.from(name).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new StorageError('invalid', '资源路径必须是安全的 asset/ 单层文件');
  }
}

export function validateResources(
  assets: ResourceDescriptor[],
  limits: StorageLimits,
): void {
  if (!Array.isArray(assets) || assets.length > limits.assets) {
    throw new StorageError('capacity', '文章资源数量超出限制');
  }
  const paths = new Set<string>();
  for (const asset of assets) {
    if (!asset || typeof asset.path !== 'string')
      throw new StorageError('invalid', '资源清单无效');
    assertAssetPath(asset.path);
    const folded = asset.path.toLocaleLowerCase('en-US');
    if (
      paths.has(folded) ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0
    ) {
      throw new StorageError('invalid', '资源重名、摘要或大小无效');
    }
    if (asset.size > limits.assetBytes)
      throw new StorageError('capacity', '单个资源超出限制');
    paths.add(folded);
  }
}

/** 对 JSON 值规范化，不重新生成正文或丢弃未知元数据字段。 */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new StorageError('invalid', '元数据嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item: unknown) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], depth + 1)}`,
      )
      .join(',')}}`;
  }
  throw new StorageError('invalid', '元数据必须为有限 JSON 值');
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}

export function metadataBytes(
  value: unknown,
  articleId: string,
  limit: number,
): Buffer {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new StorageError('invalid', '文章元数据无效');
  const row = value as Record<string, unknown>;
  if (row.id !== articleId || 'markdown' in row)
    throw new StorageError('invalid', '元数据文章 ID 不匹配或含重复正文');
  for (const key of ['savedAt', 'theme', 'themeName', 'customCSS']) {
    if (typeof row[key] !== 'string')
      throw new StorageError('invalid', `文章字段 ${key} 无效`);
  }
  if (!Number.isFinite(Date.parse(row.savedAt as string)))
    throw new StorageError('invalid', '保存时间无效');
  for (const key of ['title', 'createdAt', 'filePath']) {
    if (row[key] !== undefined && typeof row[key] !== 'string')
      throw new StorageError('invalid', `文章字段 ${key} 无效`);
  }
  const bytes = Buffer.from(canonicalJson(value), 'utf8');
  if (bytes.length > limit)
    throw new StorageError('capacity', '文章元数据超出限制');
  return bytes;
}

export function articleIndex(metadata: Record<string, JsonValue>): {
  title: string;
  savedAt: string;
} {
  if (
    typeof metadata.savedAt !== 'string' ||
    (metadata.title !== undefined && typeof metadata.title !== 'string')
  ) {
    throw new StorageError('invalid', '文章索引字段无效');
  }
  return { title: metadata.title || '未命名文章', savedAt: metadata.savedAt };
}
