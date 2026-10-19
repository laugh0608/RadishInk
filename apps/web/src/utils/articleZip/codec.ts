import { Inflate, zipSync } from "fflate";
import {
  assertAssetPath,
  assertSegment,
} from "../../storage/articles/articleContract";
import {
  inspectImage,
  IMAGE_LIMITS,
} from "../../components/ArticleAssets/imagePolicy";

import { ZIP_LIMITS } from "./limits";
export { ZIP_LIMITS } from "./limits";
export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}
export interface ArticleZip {
  root: string;
  entries: ZipEntry[];
}
const fail = (reason: string): never => {
  throw new Error(`文章包无效：${reason}`);
};
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function validateEntry(path: string, bytes: Uint8Array) {
  if (path === "index.md") {
    if (bytes.length > ZIP_LIMITS.markdown) fail("正文超过 5 MiB");
    return;
  }
  assertAssetPath(path);
  if (!bytes.length || bytes.length > IMAGE_LIMITS.bytes)
    fail("单张图片为空或超过 10 MiB");
  const info = inspectImage(bytes);
  const extension = path.split(".").pop()!.toLowerCase();
  if (
    !(
      info.extension === extension ||
      (info.extension === "jpg" && extension === "jpeg")
    )
  )
    fail("图片扩展名与实际格式不符");
}

/** 先检查中央目录和本地头，逐块解压并约束实际输出，禁止直接 unzip 不可信输入。 */
export function decodeArticleZip(
  bytes: Uint8Array,
  progress: (value: number) => void = () => {},
): ArticleZip {
  if (bytes.length < 22 || bytes.length > ZIP_LIMITS.bytes)
    fail("包体为空、损坏或超过 64 MiB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)
  )
    end--;
  if (
    end < Math.max(0, bytes.length - 65557) ||
    u32(end) !== 0x06054b50 ||
    end + 22 + u16(end + 20) !== bytes.length
  )
    fail("缺少 ZIP 结束记录");
  const count = u16(end + 10),
    centralSize = u32(end + 12),
    centralStart = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count === 0xffff ||
    centralStart === 0xffffffff ||
    centralSize === 0xffffffff
  )
    fail("不支持分卷或 ZIP64");
  if (
    !count ||
    count > ZIP_LIMITS.entries ||
    centralStart + centralSize !== end
  )
    fail("条目过多或中央目录损坏");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const checkExtra = (start: number, length: number) => {
    const stop = start + length;
    for (let offset = start; offset < stop; ) {
      if (offset + 4 > stop || offset + 4 + u16(offset + 2) > stop)
        fail("扩展字段损坏");
      if ([1, 0x7075, 0x9901].includes(u16(offset)))
        fail("不支持 ZIP64、替代路径或加密字段");
      offset += 4 + u16(offset + 2);
    }
  };
  const names = new Set<string>();
  const records: {
    path: string;
    offset: number;
    start: number;
    size: number;
    expanded: number;
    crc: number;
    method: number;
    directory: boolean;
  }[] = [];
  let position = centralStart,
    total = 0,
    root = "";
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || u32(position) !== 0x02014b50)
      fail("中央目录条目损坏");
    const flags = u16(position + 8),
      method = u16(position + 10),
      crc = u32(position + 16),
      size = u32(position + 20),
      expanded = u32(position + 24);
    const nameLength = u16(position + 28),
      extraLength = u16(position + 30),
      commentLength = u16(position + 32),
      offset = u32(position + 42);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      flags & ~0x800 ||
      ![0, 8].includes(method) ||
      u16(position + 34)
    )
      fail("不支持加密、数据描述符或此压缩格式");
    checkExtra(position + 46 + nameLength, extraLength);
    const name = decoder.decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    const directory = name.endsWith("/");
    const parts = (directory ? name.slice(0, -1) : name).split("/");
    parts.forEach(assertSegment);
    if (!root) root = parts[0];
    if (parts[0] !== root) fail("必须只有一个顶层文章目录");
    const path = parts.slice(1).join("/");
    if (
      directory
        ? !["", "asset"].includes(path)
        : path !== "index.md" && !/^asset\/[^/]+$/.test(path)
    )
      fail("仅支持 index.md 和 asset/ 图片");
    const key = name.replace(/\/$/, "").normalize("NFC").toLowerCase();
    if (names.has(key)) fail("路径重复或大小写冲突");
    names.add(key);
    const mode = (u32(position + 38) >>> 16) & 0xf000;
    if (mode && mode !== (directory ? 0x4000 : 0x8000))
      fail("不支持符号链接或特殊文件");
    if (directory && (size || expanded || crc)) fail("目录不能含数据");
    if (
      expanded >
        (path === "index.md" ? ZIP_LIMITS.markdown : IMAGE_LIMITS.bytes) ||
      (total += expanded) > ZIP_LIMITS.bytes
    )
      fail("声明展开大小超过限制");
    if (offset + 30 > centralStart || u32(offset) !== 0x04034b50)
      fail("本地文件头损坏");
    const localNameLength = u16(offset + 26),
      localExtraLength = u16(offset + 28),
      start = offset + 30 + localNameLength + localExtraLength;
    if (
      start + size > centralStart ||
      u16(offset + 6) !== flags ||
      u16(offset + 8) !== method ||
      u32(offset + 14) !== crc ||
      u32(offset + 18) !== size ||
      u32(offset + 22) !== expanded ||
      decoder.decode(
        bytes.subarray(offset + 30, offset + 30 + localNameLength),
      ) !== name
    )
      fail("本地头与中央目录不一致");
    checkExtra(offset + 30 + localNameLength, localExtraLength);
    records.push({
      path,
      offset,
      start,
      size,
      expanded,
      crc,
      method,
      directory,
    });
    position = next;
  }
  if (
    position !== end ||
    records.filter((r) => r.path === "index.md" && !r.directory).length !== 1
  )
    fail("缺少唯一 index.md");
  let boundary = 0;
  for (const record of [...records].sort((a, b) => a.offset - b.offset)) {
    if (record.offset !== boundary) fail("重叠文件或隐藏数据");
    boundary = record.start + record.size;
  }
  if (boundary !== centralStart) fail("中央目录前存在隐藏数据");
  const entries: ZipEntry[] = [];
  records.forEach((record, index) => {
    if (!record.directory) {
      let output: Uint8Array;
      const compressed = bytes.subarray(
        record.start,
        record.start + record.size,
      );
      if (record.method === 0) output = compressed.slice();
      else {
        output = new Uint8Array(record.expanded);
        let length = 0;
        const inflater = new Inflate((chunk) => {
          if (length + chunk.length > record.expanded)
            fail("实际展开大小超过声明");
          output.set(chunk, length);
          length += chunk.length;
        });
        // 每次输入至多 1 KiB，限制恶意 deflate 的单次膨胀峰值。
        for (let offset = 0; offset < compressed.length; offset += 1024)
          inflater.push(
            compressed.subarray(offset, offset + 1024),
            offset + 1024 >= compressed.length,
          );
        if (length !== record.expanded) fail("展开大小不符");
      }
      if (output.length !== record.expanded || crc32(output) !== record.crc)
        fail("大小或 CRC 校验失败");
      validateEntry(record.path, output);
      entries.push({ path: record.path, bytes: output });
    }
    progress(Math.round(((index + 1) * 100) / count));
  });
  return { root, entries };
}

export function encodeArticleZip(
  value: ArticleZip,
  progress: (value: number) => void = () => {},
) {
  assertSegment(value.root);
  if (value.entries.length + 2 > ZIP_LIMITS.entries) fail("条目超过 128 项");
  const entries: Record<string, Uint8Array> = Object.create(null);
  entries[`${value.root}/`] = new Uint8Array();
  entries[`${value.root}/asset/`] = new Uint8Array();
  let total = 0;
  for (const entry of value.entries) {
    validateEntry(entry.path, entry.bytes);
    if ((total += entry.bytes.length) > ZIP_LIMITS.bytes)
      fail("展开总量超过 64 MiB");
    const path = `${value.root}/${entry.path}`;
    if (Object.hasOwn(entries, path)) fail("路径重复");
    entries[path] = entry.bytes;
  }
  // 图片已压缩；STORE 避免耗时和无收益的再次压缩，也便于外部解包。
  const bytes = zipSync(entries, { level: 0 });
  decodeArticleZip(bytes, progress); // 导出必须满足相同的回读限制。
  return bytes;
}
