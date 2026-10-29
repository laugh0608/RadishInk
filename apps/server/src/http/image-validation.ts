import sharp from 'sharp';
import { extname } from 'node:path';
import { ApiError } from './api-error';
import { HTTP_POLICY } from './server-policy';
import { DEFAULT_STORAGE_LIMITS } from '../storage/storage-contract';

sharp.cache(false);
sharp.concurrency(1);
export function imageMime(bytes: Uint8Array): string {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (
    b.toString('ascii', 0, 6) === 'GIF87a' ||
    b.toString('ascii', 0, 6) === 'GIF89a'
  )
    return 'image/gif';
  if (
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new ApiError(422, 'invalid-image');
}
export async function validateImage(
  bytes: Uint8Array,
  path: string,
): Promise<void> {
  if (bytes.byteLength > DEFAULT_STORAGE_LIMITS.assetBytes)
    throw new ApiError(413, 'image-too-large');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mime = imageMime(b);
  const allowed: Record<string, string[]> = {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
  };
  if (!allowed[mime].includes(extname(path).toLowerCase()))
    throw new ApiError(422, 'image-extension');
  if (
    (mime === 'image/png' &&
      !b
        .subarray(-12)
        .equals(Buffer.from('0000000049454e44ae426082', 'hex'))) ||
    (mime === 'image/jpeg' && (b.at(-2) !== 255 || b.at(-1) !== 217)) ||
    (mime === 'image/gif' && b.at(-1) !== 59) ||
    (mime === 'image/webp' && b.readUInt32LE(4) + 8 !== b.length)
  )
    throw new ApiError(422, 'truncated-image');
  const decoder = sharp(b, {
    animated: true,
    failOn: 'warning',
    limitInputPixels: HTTP_POLICY.imagePixels,
    sequentialRead: true,
  }).timeout({ seconds: 15 });
  try {
    const info = await decoder.metadata();
    if (
      !info.width ||
      !info.height ||
      info.width * (info.pageHeight ?? info.height) * (info.pages ?? 1) >
        HTTP_POLICY.imagePixels ||
      !['png', 'jpeg', 'gif', 'webp'].includes(info.format)
    )
      throw new ApiError(422, 'image-dimensions');
    // raw 输出必须完整消费，metadata() 本身不证明压缩数据可解码。一次仅验证一张图片。
    for await (const chunk of decoder.raw()) {
      void chunk;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'image-decode');
  } finally {
    decoder.destroy();
  }
}
