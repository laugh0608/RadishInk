import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  electronClipboardWriteText: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { copyAsHtml } from "../../services/htmlCopyService";

describe("复制 HTML 属性语法", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.electronClipboardWriteText.mockResolvedValue({ success: true });
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: {
        isElectron: true,
        clipboard: { writeText: mocked.electronClipboardWriteText },
      },
    });
  });

  it("清理原生 HTML 的活动内容后再复制", async () => {
    await copyAsHtml(
      '<p style="color:red">保留正文</p><img src="data:image/png;base64,broken" onerror="window.reviewProbe=1"><a href="javascript:window.reviewProbe=1">链接</a>',
    );
    const [html] = mocked.electronClipboardWriteText.mock.calls[0] as [string];
    expect(html).toContain("保留正文");
    expect(html).toContain('style="color:red"');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("保留合法属性并排除危险属性", async () => {
    await copyAsHtml(
      '## 摘要 {.chapter #summary data-kind=heading onclick="alert(1)"}',
    );

    expect(mocked.electronClipboardWriteText).toHaveBeenCalledWith(
      '<h2 class="chapter" id="summary" data-kind="heading">摘要</h2>\n',
    );
    const [html] = mocked.electronClipboardWriteText.mock.calls[0] as [string];
    expect(html).not.toContain("data-wemd-source-");
  });

  it("保留图片、链接和行内格式元素的局部属性", async () => {
    await copyAsHtml(
      "![封面](https://example.com/cover.png){.hero-image #cover}\n\n[查看详情](https://example.com){.cta-link}\n\n这是 **重点内容**{.inline-highlight}。",
    );

    const [html] = mocked.electronClipboardWriteText.mock.calls[0] as [string];
    expect(html).toContain(
      '<img src="https://example.com/cover.png" alt="封面" class="hero-image" id="cover">',
    );
    expect(html).toContain(
      '<a href="https://example.com" class="cta-link">查看详情</a>',
    );
    expect(html).toContain(
      '<strong class="inline-highlight">重点内容</strong>',
    );
  });
});
