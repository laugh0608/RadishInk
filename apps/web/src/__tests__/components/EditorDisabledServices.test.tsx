import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "../../components/Editor/MarkdownEditor";
import { Header } from "../../components/Header/Header";
import { useEditorStore } from "../../store/editorStore";
import toast from "react-hot-toast";

vi.mock("../../storage/StorageContext", () => ({
  useStorageContext: () => ({ type: "indexeddb", ready: true }),
}));
vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../components/Theme/ThemePanel", () => ({
  ThemePanel: () => null,
}));
vi.mock("../../hooks/useUITheme", () => ({
  useUITheme: (select: (state: object) => unknown) =>
    select({ theme: "default", setTheme: vi.fn() }),
}));
const source = "保留选中文字\n![外链](https://images.example.test/old.png)";
let values: Map<string, string>;
beforeEach(() => {
  values = new Map([
    [
      "wemd-ai-config",
      JSON.stringify({
        enabled: true,
        provider: "custom",
        providers: {
          custom: {
            baseUrl: "https://ai.example.test/v1",
            apiKey: "synthetic",
            model: "fixture",
          },
        },
      }),
    ],
    [
      "imageHostConfig",
      JSON.stringify({
        type: "official",
        config: { serverUrl: "https://upload.example.test" },
      }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("fetch", vi.fn());
  useEditorStore.setState({ markdown: source, isEditing: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("移除 Web 上传和 AI 调用", () => {
  it("旧启用配置和设置事件不能复活功能，常规与浮动栏均无入口", () => {
    const original = new Map(values);
    render(<Header />);
    act(() => window.dispatchEvent(new CustomEvent("wemd-open-ai-settings")));
    expect(screen.queryByText("AI 优化")).not.toBeInTheDocument();
    expect(screen.queryByText("图床设置")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "隐藏标题栏" }));
    expect(
      screen.queryByRole("button", { name: /AI|图床/ }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    for (const [key, value] of original) expect(values.get(key)).toBe(value);
  });

  it.each(["paste", "drop"])(
    "图片 %s 保留正文、选区与外链，不插入占位或发起请求",
    (kind) => {
      const { container } = render(<MarkdownEditor />);
      const dom = container.querySelector<HTMLElement>(".cm-editor")!;
      const view = EditorView.findFromDOM(dom)!;
      act(() => view.dispatch({ selection: { anchor: 0, head: 7 } }));
      const image = new File(["synthetic"], "fixture.png", {
        type: "image/png",
      });
      const event = new Event(kind, { bubbles: true, cancelable: true });
      if (kind === "paste")
        Object.defineProperty(event, "clipboardData", {
          value: {
            items: [{ type: "image/png", getAsFile: () => image }],
            getData: () => "",
          },
        });
      else
        Object.defineProperty(event, "dataTransfer", {
          value: { files: [image], getData: () => "" },
        });
      fireEvent(view.contentDOM, event);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(view.state.selection.main.from).toBe(0);
      expect(view.state.selection.main.to).toBe(7);
      expect(useEditorStore.getState().markdown).toBe(source);
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining(
          kind === "drop" ? "拖入图片尚未开放" : "当前未启用文章存储",
        ),
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: /AI 改写|上传图片/ }),
      ).not.toBeInTheDocument();
    },
  );
});
