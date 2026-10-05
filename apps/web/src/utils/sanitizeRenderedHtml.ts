import DOMPurify from "dompurify";

/**
 * Markdown may contain raw HTML. Clean the rendered fragment before it enters
 * a live preview or copy container; leave the saved Markdown source untouched.
 * Keep HTML formatting, SVG and MathML, but exclude document-level styles and
 * interactive/embedded content. Theme CSS is supplied through separate nodes.
 */
export const sanitizeRenderedHtml = (html: string): string => {
  if (!DOMPurify.isSupported) {
    throw new Error("当前浏览器不支持安全 HTML 预览，请更新浏览器");
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "option",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
    ],
    FORBID_ATTR: ["srcdoc", "autofocus"],
  });
};
