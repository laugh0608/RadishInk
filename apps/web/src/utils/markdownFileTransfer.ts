import { normalizeMarkdownFileName } from "./fileName";
import {
  parseMarkdownFileContent,
  stripMarkdownExtension,
} from "./markdownFileMeta";

export const MAX_MARKDOWN_FILE_BYTES = 5 * 1024 * 1024;

export async function readMarkdownFile(file: File) {
  if (!/\.(?:md|markdown)$/i.test(file.name))
    throw new Error("请选择 .md 或 .markdown 文件");
  if (file.size > MAX_MARKDOWN_FILE_BYTES)
    throw new Error("文件超过 5 MiB，请缩小后重试");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_MARKDOWN_FILE_BYTES)
    throw new Error("文件超过 5 MiB，请缩小后重试");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("无法按 UTF-8 解码，请先将文件转换为 UTF-8");
  }
  if (
    Array.from(source).some((char) => {
      const code = char.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
      );
    })
  )
    throw new Error("文件包含二进制或不支持的控制字符");
  source = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const parsed = parseMarkdownFileContent(source);
  const title =
    parsed.title || stripMarkdownExtension(file.name).trim() || "未命名文章";
  return { source, parsed, title, fileName: normalizeMarkdownFileName(title) };
}

/** 下载发起不等于用户已在磁盘保存；延迟回收以兼容浏览器的下载读取。 */
export function downloadMarkdownFile(title: string, content: string) {
  const source = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blob = new Blob([source], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = normalizeMarkdownFileName(title);
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
