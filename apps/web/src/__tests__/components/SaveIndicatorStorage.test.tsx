import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syntheticArticle } from "../storage/articlePrototypeFixtures";
const context = vi.hoisted(() => ({ type: "indexeddb" }));
vi.mock("../../storage/StorageContext", () => ({
  useStorageContext: () => context,
}));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  context.type = "indexeddb";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function setup() {
  const { useHistoryStore: history } = await import("../../store/historyStore");
  const { useHistoryStorageState: storage } = await import(
    "../../store/historyStorageState"
  );
  const { useEditorStore: editor } = await import("../../store/editorStore");
  const { useThemeStore: theme } = await import("../../store/themeStore");
  history.setState({
    history: [
      { ...syntheticArticle("one"), markdown: "旧正文", customCSS: "" },
    ],
    activeId: "one",
  });
  storage.setState({ status: "ready" });
  editor.setState({ markdown: "尚未提交的正文", isEditing: true });
  theme.setState({ themeId: "default", themeName: "默认主题", customCSS: "" });
  const { SaveIndicator } = await import(
    "../../components/Editor/SaveIndicator"
  );
  render(<SaveIndicator />);
  return { history, editor, storage };
}
it("经过输入延时也不伪造保存时间，只有匹配已提交快照才显示已保存", async () => {
  const { history, editor } = await setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(screen.getByText("编辑中")).toBeInTheDocument();
  expect(editor.getState().lastAutoSavedAt).toBeNull();
  act(() => {
    history.setState({
      history: [
        {
          ...history.getState().history[0],
          markdown: "尚未提交的正文",
          savedAt: new Date().toISOString(),
        },
      ],
    });
  });
  expect(screen.getByText("刚刚保存")).toBeInTheDocument();
});
it("保存失败保持未保存，不因计时器流逝变为成功", async () => {
  const { history } = await setup();
  act(() => {
    history.setState({ saveError: "quota" });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(screen.getByText("未保存")).toBeInTheDocument();
});
it("目录模式继续使用真实文件保存状态，不套用浏览器文章状态", async () => {
  context.type = "filesystem";
  const { useFileStore } = await import("../../store/fileStore");
  useFileStore.setState({ isSaving: true });
  await setup();
  expect(screen.getByText("保存中...")).toBeInTheDocument();
});
