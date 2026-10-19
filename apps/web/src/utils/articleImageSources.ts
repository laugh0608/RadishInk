import { assertAssetPath } from "../storage/articles/articleContract";

export function isArticleImageSource(source: string): boolean {
  return !!source && !/^(?:https?:|data:|\/\/|\/images\/)/i.test(source);
}

/** 在 inert template 中解析，替换完成前不能挂到活动 DOM 发起错误 HTTP 请求。 */
export function resolveArticleImages(
  html: string,
  urls: ReadonlyMap<string, string>,
) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const missing: string[] = [];
  for (const image of template.content.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    // srcset 可绕过 src 解析；预览统一使用经解析的单一 src。
    image.removeAttribute("srcset");
    if (!isArticleImageSource(source)) continue;
    let url: string | undefined;
    try {
      assertAssetPath(source);
      url = urls.get(source);
    } catch {
      /* 非包内路径不解析。 */
    }
    if (url) image.setAttribute("src", url);
    else {
      missing.push(source);
      image.removeAttribute("src");
      image.setAttribute(
        "alt",
        `${image.getAttribute("alt") || "图片"}（资源缺失或路径不支持）`,
      );
    }
  }
  for (const source of template.content.querySelectorAll("source"))
    source.removeAttribute("srcset");
  return { html: template.innerHTML, missing };
}

export function assertCopyableImages(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const count = [...template.content.querySelectorAll("img")].filter((image) =>
    isArticleImageSource(image.getAttribute("src") ?? ""),
  ).length;
  if (count)
    throw new Error(
      `文章含 ${count} 张本地图片，尚未验证公众号转存；本次未复制。请保留正文与原图，待含资源导出可用后手工插入，或明确替换为可访问的图片链接。`,
    );
}
