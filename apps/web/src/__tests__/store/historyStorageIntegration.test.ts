import { beforeEach, expect, it, vi } from "vitest";
import { parseMarkdownFileContent } from "../../utils/markdownFileMeta";
import { syntheticArticle } from "../storage/articlePrototypeFixtures";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("../../store/historyDb", () => ({
  loadHistoryFromDb: mocks.load,
  updateHistoryInDb: mocks.update,
  addHistoryToDb: mocks.add,
  deleteHistoryFromDb: mocks.remove,
  clearHistoryDb: mocks.clear,
}));
vi.mock("../../store/editorStore", () => ({
  useEditorStore: { getState: () => ({ setFilePath: vi.fn() }) },
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.update.mockResolvedValue(undefined);
  mocks.add.mockResolvedValue(undefined);
});
it("读取失败保留原列表和明确错误，不误建示例文章；重试只加载一次", async () => {
  const { useHistoryStore: store } = await import("../../store/historyStore");
  store.setState({ history: [syntheticArticle("kept")], activeId: "kept" });
  mocks.load
    .mockRejectedValueOnce(new Error("blocked"))
    .mockResolvedValue([syntheticArticle("retry")]);
  await store.getState().loadHistory();
  expect(store.getState().history[0].id).toBe("kept");
  expect(store.getState().error).toBe("blocked");
  await Promise.all([
    store.getState().loadHistory(),
    store.getState().loadHistory(),
  ]);
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(store.getState().error).toBe("");
});
it("超过 30 篇的旧文全部保留，删除一篇也不裁剪；创建失败不改列表", async () => {
  const { useHistoryStore: store } = await import("../../store/historyStore");
  mocks.load.mockResolvedValue(
    Array.from({ length: 32 }, (_, i) => syntheticArticle(`old-${i}`)),
  );
  await store.getState().loadHistory();
  await store.getState().deleteEntry("old-0");
  expect(store.getState().history).toHaveLength(31);
  mocks.add.mockRejectedValue(new Error("capacity"));
  await expect(
    store.getState().saveSnapshot(syntheticArticle("new"), { force: true }),
  ).rejects.toThrow("capacity");
  expect(store.getState().history).toHaveLength(31);
});
it("排队保存绑定调用时文章，重命名后保存保留新标题及未知元数据", async () => {
  const { useHistoryStore: store } = await import("../../store/historyStore");
  mocks.load.mockResolvedValue([
    syntheticArticle("one"),
    syntheticArticle("two"),
  ]);
  await store.getState().loadHistory();
  store.getState().setActiveId("one");
  const rename = store.getState().updateTitle("one", "新标题");
  const pending = store.getState().persistActiveSnapshot({
    markdown: "后续编辑",
    theme: "default",
    themeName: "默认",
    customCSS: "",
  });
  store.getState().setActiveId("two");
  await Promise.all([rename, pending]);
  expect(mocks.update.mock.calls[1][0]).toMatchObject({
    id: "one",
    title: "新标题",
  });
  expect(
    parseMarkdownFileContent(mocks.update.mock.calls[1][0].markdown).body,
  ).toBe("后续编辑");
  expect(mocks.update.mock.calls[1][0].markdown).toContain("customFlag: keep");
  expect(store.getState().activeId).toBe("two");
});
it("删除失败保留活动文章，错误可见", async () => {
  const { useHistoryStore: store } = await import("../../store/historyStore");
  mocks.load.mockResolvedValue([syntheticArticle("one")]);
  await store.getState().loadHistory();
  mocks.remove.mockRejectedValue(new Error("revision conflict"));
  await expect(store.getState().deleteEntry("one")).rejects.toThrow();
  expect(store.getState().activeId).toBe("one");
  expect(store.getState().saveError).toBe("revision conflict");
});
