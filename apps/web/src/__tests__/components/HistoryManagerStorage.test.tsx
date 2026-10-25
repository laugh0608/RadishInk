import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syntheticArticle } from "../storage/articlePrototypeFixtures";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn(),
  add: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("../../store/historyDb", () => ({
  loadHistoryFromDb: mocks.load,
  updateHistoryInDb: mocks.update,
  addHistoryToDb: mocks.add,
  deleteHistoryFromDb: vi.fn(),
  clearHistoryDb: mocks.clear,
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.update.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("读取失败不会替换当前编辑或创建示例文章", async () => {
  mocks.load.mockRejectedValue(new Error("upgrade required"));
  const { useEditorStore } = await import("../../store/editorStore");
  useEditorStore.setState({ markdown: "保留已有草稿" });
  const { HistoryManager } = await import(
    "../../components/History/HistoryManager"
  );
  await act(async () => {
    render(<HistoryManager />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(useEditorStore.getState().markdown).toBe("保留已有草稿");
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("已有列表重挂载后仍能自动保存", async () => {
  mocks.load.mockResolvedValue([syntheticArticle("one")]);
  const { useHistoryStore } = await import("../../store/historyStore");
  await useHistoryStore.getState().loadHistory();
  const { useEditorStore } = await import("../../store/editorStore");
  const { HistoryManager } = await import(
    "../../components/History/HistoryManager"
  );
  await act(async () => {
    render(<HistoryManager />);
  });
  await act(async () => {
    useEditorStore.getState().setMarkdown("模式切回后的编辑");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.update.mock.calls[0][0].markdown).toContain("模式切回后的编辑");
});
it("显式清空后不会在后台重新创建示例文章", async () => {
  mocks.load.mockResolvedValue([syntheticArticle("one")]);
  const { useHistoryStore } = await import("../../store/historyStore");
  const { HistoryManager } = await import(
    "../../components/History/HistoryManager"
  );
  await act(async () => {
    render(<HistoryManager />);
  });
  await act(async () => {
    await useHistoryStore.getState().clearHistory();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(mocks.add).not.toHaveBeenCalled();
  expect(useHistoryStore.getState().history).toEqual([]);
});

it("空列表先完成加载后管理器挂载仍会持久化初始示例", async () => {
  mocks.load.mockResolvedValue([]);
  mocks.add.mockResolvedValue(undefined);
  const { useHistoryStore } = await import("../../store/historyStore");
  await useHistoryStore.getState().loadHistory();
  const { HistoryManager } = await import(
    "../../components/History/HistoryManager"
  );
  await act(async () => {
    render(<HistoryManager />);
  });
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(useHistoryStore.getState().history).toHaveLength(1);
});

it("初始文章提交完成不覆盖等待期间的新输入", async () => {
  mocks.load.mockResolvedValue([]);
  let finish!: () => void;
  mocks.add.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { useHistoryStore } = await import("../../store/historyStore");
  const { useEditorStore } = await import("../../store/editorStore");
  const { HistoryManager } = await import(
    "../../components/History/HistoryManager"
  );
  await act(async () => {
    render(<HistoryManager />);
  });
  await act(async () => {
    useEditorStore.getState().setMarkdown("初始保存期间的新输入");
  });
  await act(async () => {
    finish();
  });
  expect(useHistoryStore.getState().activeId).not.toBeNull();
  expect(useEditorStore.getState().markdown).toBe("初始保存期间的新输入");
});
