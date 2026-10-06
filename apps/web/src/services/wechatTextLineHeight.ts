const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const PIXELS = /^(?:\d+(?:\.\d+)?|\.\d+)px$/;

/**
 * 冻结复制时实际使用的文字行高，避免目标编辑器重新解释继承关系。
 * 必须先读取整批值再写入：先把父节点的倍数改为 px 会改变变字号子节点的继承结果。
 * 根节点保留倍数；SVG / KaTeX 内部的零行高属于公式布局，不按正文处理。
 */
export const materializeTextLineHeightForWechat = (
  container: HTMLElement,
): void => {
  const snapshots: { node: HTMLElement; pixels: number; priority: string }[] =
    [];

  container.querySelectorAll("*").forEach((node) => {
    if (
      !(node instanceof HTMLElement) ||
      node === container.firstElementChild ||
      node.closest("svg, math, .katex, .katex-display")
    ) {
      return;
    }

    const hasDirectText = Array.from(node.childNodes).some(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
    );
    if (
      !hasDirectText &&
      !node.matches(".inline-equation") &&
      !(node.style.lineHeight && node.textContent?.trim())
    ) {
      return;
    }

    const computed = window.getComputedStyle(node);
    const lineHeight = computed.lineHeight.trim();
    const fontSize = computed.fontSize.trim();
    if (!PIXELS.test(fontSize)) return;
    const fontPixels = Number.parseFloat(fontSize);
    if (fontPixels <= 0) return;

    const pixels = PIXELS.test(lineHeight)
      ? Number.parseFloat(lineHeight)
      : NUMBER.test(lineHeight)
        ? Number.parseFloat(lineHeight) * fontPixels
        : null;
    // normal 无确定的像素值，不猜测浏览器字体度量。
    if (pixels === null || !Number.isFinite(pixels)) return;

    // 上下标及脚注的零行高不必带入公众号；字号与 vertical-align 原样保留。
    // 只修正这些语义节点，不改写用户为其他内容明确设置的紧凑行高。
    const safePixels = node.closest("sup, sub")
      ? Math.max(pixels, fontPixels)
      : pixels;
    snapshots.push({
      node,
      // 向上取整，避免 13.3333px 字号被写成 13.333px 后再次满足“小于字号”。
      pixels: Math.ceil(safePixels * 1000) / 1000,
      priority: node.style.getPropertyPriority("line-height"),
    });
  });

  snapshots.forEach(({ node, pixels, priority }) => {
    node.style.setProperty("line-height", `${pixels}px`, priority);
  });
};
