import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "../../components/Preview/MarkdownPreview";

vi.mock("../../store/editorStore", () => ({
  useEditorStore: () => ({
    markdown:
      '# 合成文章\n\n<p class="safe">正文</p><img src="data:image/png;base64,broken" onerror="window.reviewProbe=1"><a href="javascript:window.reviewProbe=1">链接</a><iframe srcdoc="active"></iframe>',
  }),
}));
const themeState = {
  themeId: "default",
  customCSS: "",
  customThemes: [],
  getThemeCSS: () => "#wemd p { color: red; }",
  getAllThemes: () => [],
};
vi.mock("../../store/themeStore", () => ({
  useThemeStore: (selector?: (state: typeof themeState) => unknown) =>
    selector ? selector(themeState) : themeState,
}));
vi.mock("../../hooks/useUITheme", () => ({
  useUITheme: (selector: (state: { theme: string }) => unknown) =>
    selector({ theme: "light" }),
}));
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

describe("MarkdownPreview HTML security boundary", () => {
  it("renders formatting without attaching active raw HTML", () => {
    const { container } = render(<MarkdownPreview />);
    const article = container.querySelector("#wemd");
    expect(article?.querySelector(".safe")?.textContent).toBe("正文");
    expect(article?.querySelector("[onerror], iframe, script")).toBeNull();
    expect(article?.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(article?.querySelector("[data-wemd-source-start]")).not.toBeNull();
  });
});
