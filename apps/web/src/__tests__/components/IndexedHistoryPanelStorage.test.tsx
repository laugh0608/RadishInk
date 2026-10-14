import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syntheticArticle } from "../storage/articlePrototypeFixtures";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn(),
  add: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("../../store/historyDb", () => ({
  loadHistoryFromDb: mocks.load,
  updateHistoryInDb: mocks.update,
  addHistoryToDb: mocks.add,
  deleteHistoryFromDb: vi.fn(),
  clearHistoryDb: vi.fn(),
}));
vi.mock("../../components/Sidebar/SidebarFooter", () => ({
  SidebarFooter: () => null,
}));
vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    error: mocks.toastError,
    success: vi.fn(),
  }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.update.mockResolvedValue(undefined);
  mocks.add.mockResolvedValue(undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function setup() {
  mocks.load.mockResolvedValue([
    { ...syntheticArticle("one"), title: "第一篇" },
    { ...syntheticArticle("two"), title: "第二篇" },
  ]);
  const { useHistoryStore: history } = await import("../../store/historyStore");
  const { useEditorStore: editor } = await import("../../store/editorStore");
  await history.getState().loadHistory();
  editor.setState({ markdown: "尚未保存的当前编辑" });
  const { IndexedHistoryPanel } = await import(
    "../../components/History/IndexedHistoryPanel"
  );
  await act(async () => {
    render(<IndexedHistoryPanel />);
  });
  return { history, editor };
}
it("点击当前文章不会用旧列表正文覆盖编辑", async () => {
  const { editor } = await setup();
  await act(async () => {
    fireEvent.click(screen.getByText("第一篇"));
  });
  expect(editor.getState().markdown).toBe("尚未保存的当前编辑");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("保存期间继续输入会取消切换，保留当前文章和新输入", async () => {
  const { history, editor } = await setup();
  let finish!: () => void;
  mocks.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    fireEvent.click(screen.getByText("第二篇"));
  });
  await act(async () => {
    editor.getState().setMarkdown("保存期间继续输入");
    finish();
  });
  expect(history.getState().activeId).toBe("one");
  expect(editor.getState().markdown).toBe("保存期间继续输入");
  expect(mocks.toastError).toHaveBeenCalledWith(
    expect.stringContaining("已保留当前编辑"),
  );
});
it("新建写入期间继续输入时，新文章留在列表，不覆盖编辑", async () => {
  const { history, editor } = await setup();
  let finish!: () => void;
  mocks.add.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "新建文章" }));
  });
  await act(async () => {
    editor.getState().setMarkdown("新建期间的后续编辑");
    finish();
  });
  expect(history.getState().history).toHaveLength(3);
  expect(history.getState().activeId).toBe("one");
  expect(editor.getState().markdown).toBe("新建期间的后续编辑");
});
