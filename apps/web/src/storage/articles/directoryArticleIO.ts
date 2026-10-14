import {
  ArticleStorageError,
  assertAssetPath,
  digest,
  normalizeLegacyArticle,
} from "./articleContract";
import type { ArticleSnapshot } from "./articleContract";
import type { HistorySnapshot } from "../../store/historyTypes";

export interface ArticleManifest {
  format: 1;
  revision: number;
  article: HistorySnapshot;
  assets: { path: string; hash: string; size: number; type: string }[];
}

export async function optionalDirectory(
  root: FileSystemDirectoryHandle,
  name: string,
) {
  try {
    return await root.getDirectoryHandle(name);
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
}

export async function optionalFile(
  root: FileSystemDirectoryHandle,
  name: string,
) {
  try {
    return await (await root.getFileHandle(name)).getFile();
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
}

export async function readText(file: Blob) {
  // 保留源文件 BOM、CRLF 和未知 frontmatter，拒绝无效 UTF-8。
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    await file.arrayBuffer(),
  );
}

export async function writeFile(
  root: FileSystemDirectoryHandle,
  name: string,
  content: string | Blob,
) {
  const stream = await (
    await root.getFileHandle(name, { create: true })
  ).createWritable();
  try {
    await stream.write(content);
    await stream.close();
  } catch (error) {
    try {
      await stream.abort();
    } catch {
      /* 保留原始磁盘/权限错误。 */
    }
    throw error;
  }
}

export async function readJson(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<unknown | null> {
  const file = await optionalFile(root, name);
  // 创建新文件后 close 失败可能留下空占位；它不代表已提交控制记录。
  return file?.size ? JSON.parse(await readText(file)) : null;
}

export function validateManifest(
  value: unknown,
  articleId: string,
): asserts value is ArticleManifest {
  if (!value || typeof value !== "object")
    throw new ArticleStorageError("invalid", "文章控制记录无效");
  const manifest = value as ArticleManifest;
  const article = normalizeLegacyArticle(manifest.article);
  if (
    manifest.format !== 1 ||
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 0 ||
    article.id !== articleId ||
    !Array.isArray(manifest.assets)
  ) {
    throw new ArticleStorageError("invalid", "文章控制记录版本或归属不匹配");
  }
  const paths = new Set<string>();
  for (const asset of manifest.assets) {
    assertAssetPath(asset.path);
    const key = asset.path.toLocaleLowerCase("en-US");
    if (
      paths.has(key) ||
      !/^[a-f0-9]{64}$/.test(asset.hash) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      typeof asset.type !== "string"
    ) {
      throw new ArticleStorageError("invalid", "资源控制记录无效");
    }
    paths.add(key);
  }
}

export async function verifyManifest(
  root: FileSystemDirectoryHandle,
  manifest: ArticleManifest,
): Promise<ArticleSnapshot> {
  const markdown = await optionalFile(root, "index.md");
  if (!markdown || (await readText(markdown)) !== manifest.article.markdown) {
    throw new ArticleStorageError(
      "conflict",
      "正文已被外部修改或缺失，请保留两份内容后处理冲突",
    );
  }
  const folder = await optionalDirectory(root, "asset");
  if (!folder) throw new ArticleStorageError("invalid", "文章资源目录缺失");
  const assets = [];
  for (const asset of manifest.assets) {
    const bytes = await optionalFile(folder, asset.path.slice(6));
    if (
      !bytes ||
      bytes.size !== asset.size ||
      (await digest(bytes)) !== asset.hash
    ) {
      throw new ArticleStorageError(
        "conflict",
        `资源已被外部修改或缺失：${asset.path}`,
      );
    }
    assets.push({
      path: asset.path,
      bytes: new Blob([bytes], { type: asset.type }),
    });
  }
  return {
    article: structuredClone(manifest.article),
    revision: manifest.revision,
    assets,
  };
}
