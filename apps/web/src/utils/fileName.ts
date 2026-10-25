const INVALID_FILE_NAME_CHARS_RE = /[\\/:*?"<>|]/g;

interface NormalizeMarkdownFileNameOptions {
  fallback?: string;
  maxLength?: number;
}

export function normalizeMarkdownFileName(
  input: string,
  options: NormalizeMarkdownFileNameOptions = {},
): string {
  const fallback = options.fallback ?? "未命名文章";
  const maxLength = options.maxLength ?? 60;

  const safeInput = Array.from(input)
    .map((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "_" : char,
    )
    .join("");
  const base = safeInput.trim().replace(/\.(?:md|markdown)$/i, "");
  const normalized = base
    .replace(INVALID_FILE_NAME_CHARS_RE, "_")

    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .trim();

  const finalName = normalized || fallback;
  return `${finalName.slice(0, maxLength)}.md`;
}

export function appendMarkdownFileNameCounter(
  fileName: string,
  counter: number,
): string {
  const normalized = normalizeMarkdownFileName(fileName);
  const base = normalized.replace(/\.md$/i, "");
  return `${base} (${counter}).md`;
}
