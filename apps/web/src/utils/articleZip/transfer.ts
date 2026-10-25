import { createMarkdownParser } from "@wemd/core";
import type { ArticleAsset } from "../../storage/articles/articleContract";
import { packageDirectoryName } from "../../storage/articles/articleContract";
import { inspectImage } from "../../components/ArticleAssets/imagePolicy";
import {
  isArticleImageSource,
  articleAssetPathFromSource,
} from "../articleImageSources";
import { readMarkdownFile } from "../markdownFileTransfer";
import { runZipWorker } from "./client";
import { ZIP_LIMITS } from "./limits";

/** 使用与预览相同的 Markdown 解析器，HTML 图片同样必须纳入检查。 */
export function inspectPackageReferences(
  markdown: string,
  assets: readonly ArticleAsset[],
) {
  const template = document.createElement("template");
  template.innerHTML = createMarkdownParser().render(markdown);
  const known = new Set(assets.map((asset) => asset.path));
  const missing = new Set<string>();
  let external = false;
  const check = (source: string) => {
    if (
      !source ||
      source.startsWith("#") ||
      /^(?:data:|mailto:|tel:)/i.test(source)
    )
      return;
    if (!isArticleImageSource(source)) {
      external = true;
      return;
    }
    try {
      if (known.has(articleAssetPathFromSource(source))) return;
    } catch {
      /* 列出具体路径 */
    }
    missing.add(source);
  };
  for (const element of template.content.querySelectorAll(
    "[src], [href], [xlink\\:href], [poster], [srcset], object[data]",
  )) {
    for (const attribute of ["src", "href", "xlink:href", "poster", "data"])
      check(element.getAttribute(attribute) || "");
    const srcset = element.getAttribute("srcset");
    // 当前预览不支持 srcset，不能以单一 src 的成功掩盖另一组本地资源。
    if (srcset)
      throw new Error(
        "文章含 srcset 图片候选，请改成明确的单一图片路径后导出文章包",
      );
  }
  for (const element of template.content.querySelectorAll("[style], style")) {
    if (
      /url\s*\(/i.test(
        element.getAttribute("style") || element.textContent || "",
      )
    )
      throw new Error("文章含 CSS 资源引用，请改成普通图片路径后使用文章包");
  }
  if (missing.size)
    throw new Error(
      `本地资源缺失或路径不支持：${[...missing].join("、")}。可改用仅 Markdown 导出保留正文`,
    );
  return { external };
}

export async function readArticleZip(
  file: File,
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  if (!/\.zip$/i.test(file.name) || file.size > ZIP_LIMITS.bytes)
    throw new Error("请选择不超过 64 MiB 的文章 ZIP");
  signal.throwIfAborted();
  const decoded = await runZipWorker(
    "decode",
    new Uint8Array(await file.arrayBuffer()),
    signal,
    progress,
  );
  const main = decoded.entries.find((entry) => entry.path === "index.md")!;
  const imported = await readMarkdownFile(
    new File([main.bytes], `${decoded.root}.md`),
  );
  const assets: ArticleAsset[] = [];
  for (const entry of decoded.entries) {
    signal.throwIfAborted();
    if (entry.path === "index.md") continue;
    const info = inspectImage(entry.bytes);
    const blob = new Blob([entry.bytes], { type: info.type });
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width !== info.width || bitmap.height !== info.height)
        throw new Error(`图片尺寸与文件头不符：${entry.path}`);
    } finally {
      bitmap.close();
    }
    assets.push({ path: entry.path, bytes: blob });
  }
  signal.throwIfAborted();
  const { external } = inspectPackageReferences(imported.parsed.body, assets);
  return { imported, assets, external };
}

export async function buildArticleZip(
  title: string,
  id: string,
  content: string,
  assets: readonly ArticleAsset[],
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  content = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const { external } = inspectPackageReferences(content, assets);
  const root = await packageDirectoryName(title, id);
  const entries = [
    { path: "index.md", bytes: new TextEncoder().encode(content) },
  ];
  let total = entries[0].bytes.length;
  if (
    entries.length + assets.length + 2 > ZIP_LIMITS.entries ||
    total > ZIP_LIMITS.markdown
  )
    throw new Error("文章正文或资源条目超过文章包限制");
  for (const asset of assets) {
    signal.throwIfAborted();
    if ((total += asset.bytes.size) > ZIP_LIMITS.bytes)
      throw new Error("文章包展开总量超过 64 MiB");
    entries.push({
      path: asset.path,
      bytes: new Uint8Array(await asset.bytes.arrayBuffer()),
    });
  }
  const bytes = await runZipWorker(
    "encode",
    { root, entries },
    signal,
    progress,
  );
  return { bytes, name: `${root}.zip`, external };
}

export function downloadArticleZip(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
