import type { ArticleAsset } from "../../storage/articles/articleContract";

export const IMAGE_LIMITS = {
  bytes: 10 * 1024 * 1024,
  pixels: 16_000_000,
  count: 10,
  batchBytes: 32 * 1024 * 1024,
} as const;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** 先检查文件头尺寸，再调用解码器；不能仅信任扩展名或 MIME。 */
export function inspectImage(bytes: Uint8Array): {
  type: string;
  extension: string;
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  let width = 0,
    height = 0,
    type = "",
    extension = "";
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 8) === "PNG\r\n\x1a\n" &&
    ascii(12, 16) === "IHDR"
  ) {
    type = "image/png";
    extension = "png";
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 10 && /GIF8[79]a/.test(ascii(0, 6))) {
    type = "image/gif";
    extension = "gif";
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (
    bytes.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP"
  ) {
    type = "image/webp";
    extension = "webp";
    const kind = ascii(12, 16);
    const uint24 = (offset: number) =>
      bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
    if (kind === "VP8X") {
      width = uint24(24) + 1;
      height = uint24(27) + 1;
    } else if (
      kind === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const packed = view.getUint32(21, true);
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    type = "image/jpeg";
    extension = "jpg";
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        size >= 8
      ) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  }
  if (!type || !width || !height)
    throw new Error("图片格式或文件头无效，仅支持 PNG、JPEG、WebP、GIF");
  if (width * height > IMAGE_LIMITS.pixels)
    throw new Error("图片解码尺寸超过 1600 万像素");
  return { type, extension, width, height };
}

export function checkImageBatch(files: readonly File[]) {
  if (files.length > IMAGE_LIMITS.count)
    throw new Error("每次最多插入 10 张图片");
  if (files.reduce((sum, file) => sum + file.size, 0) > IMAGE_LIMITS.batchBytes)
    throw new Error("本次图片总大小超过 32 MiB");
}

export async function prepareImage(file: File): Promise<ArticleAsset> {
  if (!file.size || file.size > IMAGE_LIMITS.bytes)
    throw new Error("单张图片须大于 0 字节且不超过 10 MiB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectImage(bytes);
  if (file.type && file.type !== info.type)
    throw new Error("图片 MIME 与实际格式不符");
  const blob = new Blob([bytes], { type: info.type });
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > IMAGE_LIMITS.pixels
    )
      throw new Error("图片解码尺寸无效或超过 1600 万像素");
  } finally {
    bitmap.close();
  }
  return {
    path: `asset/image-${crypto.randomUUID()}.${info.extension}`,
    bytes: blob,
  };
}
