export function resolveAppAssetPath(
  filename: string,
  baseUrl = import.meta.env.BASE_URL,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedFile = filename.replace(/^\/+/, "");
  return `${normalizedBase}${normalizedFile}`;
}

// innerHTML 保留相对 src，离开本站后会指向粘贴目标的域名。
// 读取 DOM 已解析的地址，再写回导出副本，不改写草稿内容。
export function resolveImageSourcesForCopy(container: ParentNode): void {
  container.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    if (image.getAttribute("src")) image.setAttribute("src", image.src);
  });
}
