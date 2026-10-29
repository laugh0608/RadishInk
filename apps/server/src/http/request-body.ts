import type { Request } from 'express';
import Busboy from 'busboy';
import { ApiError } from './api-error';
import { HTTP_POLICY } from './server-policy';
import {
  ArticleWrite,
  DEFAULT_STORAGE_LIMITS,
  ResourceInput,
  assertUuid,
  assertRevision,
  validateResources,
  metadataBytes,
  decodeUtf8,
} from '../storage/storage-contract';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(422, 'invalid-object');
  return value as Record<string, unknown>;
}
export function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new ApiError(422, 'unexpected-field');
}
function checkLength(req: Request, limit: number): void {
  if (
    req.headers['content-encoding'] &&
    req.headers['content-encoding'] !== 'identity'
  )
    throw new ApiError(422, 'content-encoding');
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new ApiError(413, 'request-too-large');
}
export async function readJson(
  req: Request,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  checkLength(req, HTTP_POLICY.jsonBytes);
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '')
  )
    throw new ApiError(422, 'json-required');
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', data);
      req.off('end', end);
      req.off('error', fail);
      req.off('aborted', abort);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new ApiError(503, 'request-expired'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > HTTP_POLICY.jsonBytes) {
        fail(new ApiError(413, 'request-too-large'));
        req.pause();
      } else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    req.on('data', data);
    req.once('end', end);
    req.once('error', fail);
    req.once('aborted', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return object(JSON.parse(decodeUtf8(bytes)) as unknown);
  } catch {
    throw new ApiError(422, 'invalid-json');
  }
}

export async function readArticle(
  req: Request,
  articleId: string,
  signal: AbortSignal,
): Promise<Omit<ArticleWrite, 'ownerId'>> {
  checkLength(req, HTTP_POLICY.bodyBytes);
  if (!/^multipart\/form-data\s*;/i.test(req.headers['content-type'] ?? ''))
    throw new ApiError(422, 'multipart-required');
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: {
        fields: 1,
        files: DEFAULT_STORAGE_LIMITS.assets + 1,
        // Busboy 在达到值时即触发 partsLimit，预留一个拒绝哨兵。
        parts: DEFAULT_STORAGE_LIMITS.assets + 3,
        fieldSize: HTTP_POLICY.manifestBytes + 1,
        fieldNameSize: 32,
        fileSize: DEFAULT_STORAGE_LIMITS.assetBytes + 1,
      },
    });
  } catch {
    throw new ApiError(422, 'invalid-multipart');
  }
  const files = new Map<string, Buffer>();
  let manifestText: string | undefined;
  await new Promise<void>((resolve, reject) => {
    let total = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', count);
      req.off('error', fail);
      req.off('aborted', abort);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.unpipe(parser);
      req.pause();
      // Busboy 的 limit 回调返回后仍会写内部 stream 状态，不能在回调内同步销毁。
      queueMicrotask(() => parser.destroy());
      reject(error);
    };
    const abort = () => fail(new ApiError(503, 'request-expired'));
    const count = (chunk: Buffer) => {
      total += chunk.length;
      if (total > HTTP_POLICY.bodyBytes)
        fail(new ApiError(413, 'request-too-large'));
    };
    const limit = () => fail(new ApiError(413, 'multipart-limit'));
    parser.on('field', (name, value, info) => {
      if (settled) return;
      if (
        info.nameTruncated ||
        info.valueTruncated ||
        Buffer.byteLength(value) > HTTP_POLICY.manifestBytes
      )
        return limit();
      if (name !== 'manifest' || manifestText !== undefined)
        return fail(new ApiError(422, 'invalid-manifest-part'));
      manifestText = value;
    });
    const seen = new Set<string>();
    parser.on('file', (name, stream) => {
      stream.on('error', () => fail(new ApiError(422, 'invalid-multipart')));
      if (settled) {
        stream.resume();
        return;
      }
      if (
        !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name) ||
        name === 'manifest' ||
        seen.has(name)
      ) {
        stream.resume();
        return fail(new ApiError(422, 'invalid-file-part'));
      }
      seen.add(name);
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('limit', limit);
      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (name === 'markdown' && size > DEFAULT_STORAGE_LIMITS.markdownBytes)
          return limit();
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (!settled) files.set(name, Buffer.concat(chunks, size));
      });
    });
    parser.on('filesLimit', limit);
    parser.on('fieldsLimit', limit);
    parser.on('partsLimit', limit);
    parser.on('error', () => fail(new ApiError(422, 'invalid-multipart')));
    parser.on('close', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });
    req.on('data', count);
    req.once('error', fail);
    req.once('aborted', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else req.pipe(parser);
  });
  if (manifestText === undefined || !files.has('markdown'))
    throw new ApiError(422, 'missing-part');
  let manifest: Record<string, unknown>;
  try {
    manifest = object(JSON.parse(manifestText) as unknown);
  } catch {
    throw new ApiError(422, 'invalid-manifest');
  }
  exactKeys(manifest, [
    'operationId',
    'expectedRevision',
    'metadata',
    'assets',
  ]);
  if (typeof manifest.operationId !== 'string')
    throw new ApiError(422, 'invalid-operation');
  assertUuid(manifest.operationId);
  const expectedRevision = manifest.expectedRevision as number | null;
  assertRevision(expectedRevision);
  const metadata = object(manifest.metadata) as ArticleWrite['metadata'];
  if (
    Buffer.byteLength(JSON.stringify(metadata)) >
    DEFAULT_STORAGE_LIMITS.metadataBytes
  )
    throw new ApiError(413, 'metadata-too-large');
  metadataBytes(metadata, articleId, DEFAULT_STORAGE_LIMITS.metadataBytes);
  if (
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > DEFAULT_STORAGE_LIMITS.assets
  )
    throw new ApiError(413, 'assets-limit');
  const used = new Set(['markdown']);
  const assets: ResourceInput[] = manifest.assets.map((item: unknown) => {
    const asset = object(item);
    exactKeys(asset, ['path', 'sha256', 'size', 'partId']);
    if (
      typeof asset.path !== 'string' ||
      typeof asset.sha256 !== 'string' ||
      typeof asset.size !== 'number'
    )
      throw new ApiError(422, 'invalid-asset');
    let bytes: Buffer | undefined;
    if (asset.partId !== undefined) {
      if (
        typeof asset.partId !== 'string' ||
        used.has(asset.partId) ||
        !files.has(asset.partId)
      )
        throw new ApiError(422, 'asset-part');
      used.add(asset.partId);
      bytes = files.get(asset.partId);
    }
    if (asset.size > DEFAULT_STORAGE_LIMITS.assetBytes)
      throw new ApiError(413, 'asset-too-large');
    return { path: asset.path, sha256: asset.sha256, size: asset.size, bytes };
  });
  validateResources(assets, DEFAULT_STORAGE_LIMITS);
  if (used.size !== files.size) throw new ApiError(422, 'unreferenced-part');
  const body = files.get('markdown')!;
  if (
    body.length +
      Buffer.byteLength(JSON.stringify(metadata)) +
      assets.reduce((sum, x) => sum + x.size, 0) >
    DEFAULT_STORAGE_LIMITS.articleBytes
  )
    throw new ApiError(413, 'article-too-large');
  let markdown: string;
  try {
    markdown = decodeUtf8(body);
  } catch {
    throw new ApiError(422, 'invalid-utf8');
  }
  return {
    articleId,
    operationId: manifest.operationId,
    expectedRevision,
    metadata,
    assets,
    markdown,
  };
}
