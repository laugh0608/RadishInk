import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "../../components/Editor/Toolbar";
import { TooltipLayer } from "../../components/common/TooltipLayer";

let width = 800;
let buttonWidth = 34;
let resize = () => {};
const rect = () => ({
  x: 0,
  y: 0,
  width: buttonWidth,
  height: buttonWidth,
  top: 0,
  right: buttonWidth,
  bottom: buttonWidth,
  left: 0,
  toJSON: () => ({}),
});
function setWidth(value: number) {
  act(() => {
    width = value;
    resize();
  });
}
function labels(root: HTMLElement) {
  return within(root)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

beforeEach(() => {
  width = 800;
  buttonWidth = 34;
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    rect,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("按编辑区宽度渐进收纳", () => {
  it("只将溢出命令放入更多，宽窄变化不丢失或重复命令", () => {
    render(<Toolbar onInsert={vi.fn()} />);
    const toolbar = screen.getByRole("toolbar");
    const all = labels(toolbar);
    expect(
      screen.queryByRole("button", { name: "更多编辑工具" }),
    ).not.toBeInTheDocument();
    setWidth(340);
    const medium = labels(toolbar).filter((label) => label !== "更多编辑工具");
    expect(medium.length).toBeGreaterThan(2);
    expect(medium.length).toBeLessThan(all.length);
    fireEvent.click(screen.getByRole("button", { name: "更多编辑工具" }));
    const overflow = Array.from(
      screen.getByRole("menu").querySelectorAll("[role^=menuitem]"),
    ).map((item) => item.textContent);
    expect([...medium, ...overflow].sort()).toEqual([...all].sort());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    setWidth(150);
    expect(labels(toolbar).length).toBeLessThan(medium.length);
    expect(screen.getByRole("button", { name: "粗体" })).toBeInTheDocument();
    setWidth(34);
    expect(labels(toolbar)).toEqual(["更多编辑工具"]);
    setWidth(800);
    expect(labels(toolbar)).toEqual(all);
  });

  it("主栏与溢出菜单执行同一个命令，状态即时一致", () => {
    const insert = vi.fn();
    render(<Toolbar onInsert={insert} />);
    fireEvent.click(screen.getByRole("button", { name: "链接" }));
    expect(insert).toHaveBeenLastCalledWith("[", "](url)", "链接文字");
    setWidth(100);
    fireEvent.click(screen.getByRole("button", { name: "更多编辑工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "链接" }));
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenLastCalledWith("[", "](url)", "链接文字");
    fireEvent.click(screen.getByRole("button", { name: "更多编辑工具" }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "表格自动换行：关闭" }),
    );
    expect(localStorage.getItem("wemd-table-wrap")).toBe("true");
    setWidth(800);
    expect(
      screen.getByRole("button", { name: "表格自动换行：开启" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("焦点按钮被收纳、展开中的菜单被移回主栏时恢复到可见入口", () => {
    render(<Toolbar onInsert={vi.fn()} />);
    screen.getByRole("button", { name: "标题" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "标题" }));
    expect(screen.getByRole("menuitem", { name: "一级标题" })).toHaveFocus();
    setWidth(34);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "更多编辑工具" });
    expect(more).toHaveFocus();
    fireEvent.click(more);
    setWidth(800);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "粗体" })).toHaveFocus();
  });

  it("Portal 菜单支持方向键、子页、Esc 与焦点返回", () => {
    width = 34;
    const insert = vi.fn();
    render(<Toolbar onInsert={insert} />);
    const more = screen.getByRole("button", { name: "更多编辑工具" });
    fireEvent.keyDown(more, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "粗体" })).toHaveFocus();
    expect(screen.getByRole("toolbar")).not.toContainElement(
      screen.getByRole("menu"),
    );
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "语法帮助" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "粗体" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "标题" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("menuitem", { name: "返回" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "一级标题" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "二级标题" }));
    expect(insert).toHaveBeenCalledWith("## ", "", "标题");
    expect(more).toHaveFocus();
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(more).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("无 ResizeObserver 也跟踪容器变化和按钮实际宽度", () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Toolbar onInsert={vi.fn()} />);
    const toolbar = screen.getByRole("toolbar");
    act(() => {
      width = 340;
      vi.advanceTimersByTime(20);
    });
    const before = labels(toolbar).length;
    act(() => {
      buttonWidth = 44;
      vi.advanceTimersByTime(20);
    });
    expect(labels(toolbar).length).toBeLessThan(before);
    act(() => {
      width = 34;
      vi.advanceTimersByTime(20);
    });
    expect(labels(toolbar)).toEqual(["更多编辑工具"]);
  });

  it("键盘提示挂在 body，点击打开菜单后提示消失", () => {
    render(
      <>
        <Toolbar onInsert={vi.fn()} />
        <TooltipLayer />
      </>,
    );
    const heading = screen.getByRole("button", { name: "标题" });
    fireEvent.focusIn(heading);
    expect(screen.getByRole("tooltip")).toHaveTextContent("标题");
    expect(screen.getByRole("toolbar")).not.toContainElement(
      screen.getByRole("tooltip"),
    );
    fireEvent.pointerDown(heading);
    fireEvent.click(heading);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
