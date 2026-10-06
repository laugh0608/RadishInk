import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InformationDialog } from "../../components/Information/InformationDialog";
import { SidebarFooter } from "../../components/Sidebar/SidebarFooter";
import { SyntaxHelpPopover } from "../../components/Editor/SyntaxHelpPopover";
import { ToolbarCompactMenu } from "../../components/Editor/ToolbarCompactMenu";
import { useInformationDialogStore } from "../../store/informationDialogStore";

// AI controls share the compact menu but are unrelated to help navigation.
vi.mock("../../components/Editor/AiOptimize/AiOptimizeButtons", () => ({
  AiOptimizeButtons: () => null,
}));

function renderInformation() {
  return render(
    <StrictMode>
      <SidebarFooter />
      <SyntaxHelpPopover />
      <InformationDialog />
    </StrictMode>,
  );
}

describe("关于与帮助弹窗", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    useInformationDialogStore.getState().close();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("scrollTo", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    scrollIntoView.mockClear();
  });
  afterEach(() => {
    cleanup();
    useInformationDialogStore.getState().close();
    window.history.replaceState(null, "", "/");
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .scrollIntoView;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("侧栏使用按钮打开唯一弹窗，保留 GitHub 和全部许可入口", () => {
    const windowOpen = vi.spyOn(window, "open");
    renderInformation();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub 仓库" })).toHaveAttribute(
      "target",
      "_blank",
    );
    fireEvent.click(screen.getByRole("button", { name: "关于与许可" }));
    const dialog = screen.getByRole("dialog", { name: "关于与许可" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      within(dialog).getByRole("heading", { name: "RadishInk · 萝卜墨笺" }),
    ).toHaveFocus();
    for (const [name, file] of [
      ["源码可见许可", "licenses/RadishInk-LICENSE.txt"],
      ["WeMD MIT 许可证原文", "licenses/WeMD-LICENSE.txt"],
      ["第三方许可与声明", "licenses/third-party-notices.txt"],
      ["Maple Mono 许可", "fonts/maple-mono/LICENSE"],
    ]) {
      const link = within(dialog).getByRole("link", { name });
      expect(link.getAttribute("href")).toMatch(
        new RegExp(`${file.replaceAll(".", "\\.")}$`),
      );
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(
      within(dialog).getByText(/切换前内容保留原许可/),
    ).toBeInTheDocument();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it.each(["button", "escape", "backdrop"])(
    "支持 %s 关闭并恢复原触发按钮焦点",
    (method) => {
      renderInformation();
      const trigger = screen.getByRole("button", { name: "帮助文档" });
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "使用帮助" });
      fireEvent.click(
        within(dialog).getByRole("heading", { name: "从写作到公众号" }),
      );
      expect(dialog).toBeInTheDocument();
      if (method === "button")
        fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
      if (method === "escape") fireEvent.keyDown(window, { key: "Escape" });
      if (method === "backdrop") fireEvent.click(dialog.parentElement!);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    },
  );

  it("在弹窗内切换内容，重置滚动与焦点，关闭仍回到最初入口", () => {
    renderInformation();
    const trigger = screen.getByRole("button", { name: "关于与许可" });
    fireEvent.click(trigger);
    let dialog = screen.getByRole("dialog");
    const content = dialog.querySelector(".information-content")!;
    content.scrollTop = 500;
    fireEvent.click(within(dialog).getByRole("button", { name: "使用帮助" }));
    dialog = screen.getByRole("dialog", { name: "使用帮助" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(content.scrollTop).toBe(0);
    expect(
      within(dialog).getByRole("heading", { name: "从写作到公众号" }),
    ).toHaveFocus();
    expect(
      within(dialog).getByText(/独立的文件导入导出仍在规划中/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "来源、许可与数据说明" }),
    );
    expect(
      screen.getByRole("dialog", { name: "关于与许可" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("完整语法帮助关闭浮层并定位章节，结束后恢复常驻语法按钮", () => {
    const windowOpen = vi.spyOn(window, "open");
    renderInformation();
    const trigger = screen.getByRole("button", { name: "语法帮助" });
    fireEvent.click(trigger);
    const docs = screen.getByRole("button", { name: "查看完整文档" });
    docs.focus();
    fireEvent.click(docs);
    expect(
      screen.queryByRole("button", { name: "查看完整文档" }),
    ).not.toBeInTheDocument();
    const syntax = within(screen.getByRole("dialog")).getByRole("heading", {
      name: "Markdown 语法速查",
    });
    expect(syntax).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("Tab 与 Shift+Tab 在弹窗内循环，不把焦点留给背景", () => {
    renderInformation();
    const trigger = screen.getByRole("button", { name: "帮助文档" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "关闭" });
    const last = within(dialog).getByRole("button", {
      name: "来源、许可与数据说明",
    });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    trigger.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("紧凑工具栏关闭嵌套菜单后，弹窗仍恢复到常驻更多按钮", () => {
    render(
      <>
        <ToolbarCompactMenu
          onInsert={vi.fn()}
          uploading={false}
          onUpload={vi.fn()}
          onMermaidInsert={vi.fn()}
          linkToFootnote={false}
          tableWrap={false}
          onToggleLinkToFootnote={vi.fn()}
          onToggleTableWrap={vi.fn()}
        />
        <InformationDialog />
      </>,
    );
    const more = screen.getByRole("button", { name: "更多编辑工具" });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("button", { name: "语法帮助" }));
    fireEvent.click(screen.getByRole("button", { name: "查看完整文档" }));
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "语法帮助" }),
    ).not.toBeInTheDocument();
    const about = within(screen.getByRole("dialog")).getByRole("button", {
      name: "关于与许可",
    });
    fireEvent.mouseDown(about);
    fireEvent.click(about);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(more).toHaveFocus();
  });

  it.each([
    ["#radishink/about", "关于与许可", "RadishInk · 萝卜墨笺"],
    ["#radishink/help", "使用帮助", "从写作到公众号"],
    ["#radishink/help/syntax", "使用帮助", "Markdown 语法速查"],
  ])(
    "兼容入口 %s 在当前页面打开并保留其他 URL 状态",
    (hash, title, heading) => {
      window.history.replaceState(
        { keep: "history" },
        "",
        `/ink/?keep=query${hash}`,
      );
      renderInformation();
      expect(
        within(screen.getByRole("dialog", { name: title })).getByRole(
          "heading",
          { name: heading },
        ),
      ).toHaveFocus();
      expect(window.location.pathname).toBe("/ink/");
      expect(window.location.search).toBe("?keep=query");
      expect(window.location.hash).toBe("");
      expect(window.history.state).toEqual({ keep: "history" });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it.each(["#unrelated", "#about", "#help", "#syntax"])(
    "处理帮助链接且不消费文章锚点 %s",
    (hash) => {
      window.history.replaceState(null, "", `/${hash}`);
      renderInformation();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(window.location.hash).toBe(hash);
      act(() => {
        window.history.replaceState(null, "", "/#radishink/help/syntax");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(
        screen.getByRole("heading", { name: "Markdown 语法速查" }),
      ).toHaveFocus();
    },
  );

  it("开关和导航不读写草稿存储或触发请求", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderInformation();
    fireEvent.click(screen.getByRole("button", { name: "关于与许可" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "使用帮助",
      }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(storageWrite).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
