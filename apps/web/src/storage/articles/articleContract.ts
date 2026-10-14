import type { HistorySnapshot } from "../../store/historyTypes";
import { normalizeMarkdownFileName } from "../../utils/fileName";

export const PROTOTYPE_PREFIX = "radishink-p2a-prototype-";
export const ARTICLE_LIMIT = 30;

export class ArticleStorageError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "conflict"
      | "capacity"
      | "recovery-required"
      | "unsupported"
      | "blocked",
    message: string,
  ) {
    super(message);
    this.name = "ArticleStorageError";
  }
}

export interface ArticleAsset {
  path: string;
  bytes: Blob;
}

export interface ArticleContent {
  // 沿用 history 的完整源文和元数据，不把正文另存到 wemd-files。
  article: HistorySnapshot;
  assets: ArticleAsset[];
}

export interface ArticleSnapshot extends ArticleContent {
  revision: number;
}

/** 实例绑定一个工作区和文章；资源与正文作为同一提交单元。 */
export interface ArticleStore {
  readonly articleId: string;
  read(): Promise<ArticleSnapshot | null>;
  commit(
    content: ArticleContent,
    expectedRevision: number | null,
  ): Promise<ArticleSnapshot>;
  recover(): Promise<ArticleSnapshot | null>;
}

export function assertPrototypeName(name: string) {
  if (
    !name.startsWith(PROTOTYPE_PREFIX) ||
    name.length <= PROTOTYPE_PREFIX.length
  ) {
    throw new ArticleStorageError(
      "invalid",
      "原型只能使用明确命名的合成数据库或目录",
    );
  }
}

export function assertSegment(name: string) {
  if (
    !name ||
    name !== name.normalize("NFC") ||
    name.length > 100 ||
    /[\\/%:*?"<>|]/.test(name) ||
    /[. ]$/.test(name) ||
    name.startsWith(".") ||
    Array.from(name).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new ArticleStorageError("invalid", `非法文章路径段：${name}`);
  }
}

export function assertAssetPath(path: string) {
  const parts = path.split("/");
  if (parts.length !== 2 || parts[0] !== "asset") {
    throw new ArticleStorageError(
      "invalid",
      "资源路径必须是 asset/ 下的单个文件",
    );
  }
  assertSegment(parts[1]);
}

export function normalizeLegacyArticle(value: unknown): HistorySnapshot {
  if (!value || typeof value !== "object") {
    throw new ArticleStorageError("invalid", "文章记录不是对象");
  }
  const row = value as Record<string, unknown>;
  for (const key of [
    "id",
    "markdown",
    "savedAt",
    "theme",
    "themeName",
    "customCSS",
  ]) {
    if (typeof row[key] !== "string") {
      throw new ArticleStorageError("invalid", `文章字段 ${key} 无效`);
    }
  }
  if (
    !(row.id as string).trim() ||
    !Number.isFinite(Date.parse(row.savedAt as string))
  ) {
    throw new ArticleStorageError("invalid", "文章身份或保存时间无效");
  }
  if (row.title !== undefined && typeof row.title !== "string") {
    throw new ArticleStorageError("invalid", "文章标题无效");
  }
  if (
    row.createdAt !== undefined &&
    (typeof row.createdAt !== "string" ||
      !Number.isFinite(Date.parse(row.createdAt)))
  ) {
    throw new ArticleStorageError("invalid", "文章创建时间无效");
  }
  if (row.filePath !== undefined && typeof row.filePath !== "string") {
    throw new ArticleStorageError("invalid", "文章来源路径无效");
  }
  return {
    ...row,
    title: row.title || "未命名文章",
    createdAt: row.createdAt || row.savedAt,
  } as unknown as HistorySnapshot;
}

export function validateContent(content: ArticleContent, articleId: string) {
  const article = normalizeLegacyArticle(content.article);
  if (article.id !== articleId)
    throw new ArticleStorageError("invalid", "文章归属不匹配");
  const paths = new Set<string>();
  for (const asset of content.assets) {
    assertAssetPath(asset.path);
    const key = asset.path.toLocaleLowerCase("en-US");
    if (paths.has(key) || !(asset.bytes instanceof Blob) || !asset.bytes.size) {
      throw new ArticleStorageError("invalid", "资源重名、为空或不是 Blob");
    }
    paths.add(key);
  }
}

export function assertRevision(actual: number | null, expected: number | null) {
  if (
    actual !== expected ||
    (expected !== null && (!Number.isSafeInteger(expected) || expected < 0))
  ) {
    throw new ArticleStorageError(
      "conflict",
      "文章版本已变化，请保留当前编辑并重新读取",
    );
  }
}

export async function digest(bytes: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
  return Array.from(new Uint8Array(hash), (part) =>
    part.toString(16).padStart(2, "0"),
  ).join("");
}

export async function packageDirectoryName(title: string, id: string) {
  let base = normalizeMarkdownFileName(title.normalize("NFC"), {
    maxLength: 60,
  })
    .replace(/\.md$/, "")
    .replace(/%/g, "_");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base))
    base = `_${base}`;
  const name = `${base}--${(await digest(new Blob([id]))).slice(0, 12)}`;
  assertSegment(name);
  return name;
}
