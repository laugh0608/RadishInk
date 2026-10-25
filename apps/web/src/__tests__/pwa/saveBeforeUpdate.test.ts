import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertUpdateIdle, saveBeforeUpdate } from "../../pwa/saveBeforeUpdate";
import { useEditorStore } from "../../store/editorStore";
import { useHistoryStore } from "../../store/historyStore";
import { useThemeStore } from "../../store/themeStore";
import { useFileStore } from "../../store/fileStore";
import { useArticleTransferState } from "../../store/articleTransferState";
import { useDirectoryStorageState } from "../../store/directoryStorageState";
import type { StorageContextValue } from "../../storage/StorageContext";
import type { StorageAdapter } from "../../storage/StorageAdapter";

const db = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../store/historyDb", () => ({ updateHistoryInDb: db.update }));

let context: StorageContextValue;
const persistFile = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  db.update.mockResolvedValue(undefined);
  persistFile.mockResolvedValue(true);
  context = {
    type: "indexeddb",
    ready: true,
    message: "",
    select: vi.fn(),
    isFileSystemSupported: true,
    adapter: { ready: true } as StorageAdapter,
  };
  useHistoryStore.setState({
    loading: false,
    error: "",
    pendingWrites: 0,
    activeId: "article",
    history: [
      {
        id: "article",
        title: "合成文章",
        markdown: "---\ncustom: preserved\n---\n旧内容",
        theme: "default",
        themeName: "默认主题",
        customCSS: "",
        createdAt: "2026-10-25",
        savedAt: "2026-10-25",
      },
    ],
  });
  useEditorStore.setState({ markdown: "最新正文" });
  useThemeStore.setState({
    themeId: "default",
    themeName: "默认主题",
    customCSS: "",
  });
  useFileStore.setState({
    isLoading: false,
    isRestoring: false,
    isSaving: false,
    isDirty: true,
    currentFile: null,
    workspacePath: null,
    workspaceRevision: 0,
  });
  useArticleTransferState.setState({ imageBusy: false, fileBusy: false });
  useDirectoryStorageState.setState({ pendingOperations: 0, issue: null });
});

describe("save before update", () => {
  it("persists the latest browser body and unknown frontmatter before permitting reload", async () => {
    const guard = await saveBeforeUpdate(() => context, persistFile);
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.update.mock.calls[0][0].markdown).toContain("最新正文");
    expect(db.update.mock.calls[0][0].markdown).toContain("custom: preserved");
    expect(useHistoryStore.getState().pendingWrites).toBe(0);
    expect(() => guard()).not.toThrow();
    expect(persistFile).not.toHaveBeenCalled();
  });
  it("does not approve a failed browser transaction and retains input", async () => {
    db.update.mockRejectedValue(new Error("quota exceeded"));
    await expect(saveBeforeUpdate(() => context, persistFile)).rejects.toThrow(
      "quota exceeded",
    );
    expect(useEditorStore.getState().markdown).toBe("最新正文");
    expect(useHistoryStore.getState().pendingWrites).toBe(0);
    expect(useHistoryStore.getState().history[0].markdown).toContain("旧内容");
  });
  it("detects edits while saving and does not use the earlier snapshot to refresh", async () => {
    db.update.mockImplementation(async () => {
      useEditorStore.setState({ markdown: "继续输入" });
    });
    await expect(saveBeforeUpdate(() => context, persistFile)).rejects.toThrow(
      "发生变化",
    );
    expect(useEditorStore.getState().markdown).toBe("继续输入");
  });
  it("detects switching articles during persistence", async () => {
    db.update.mockImplementation(async () => {
      useHistoryStore.setState({ activeId: "other" });
    });
    await expect(saveBeforeUpdate(() => context, persistFile)).rejects.toThrow(
      "发生变化",
    );
  });
  it("detects changes after activation but before reload", async () => {
    const guard = await saveBeforeUpdate(() => context, persistFile);
    useThemeStore.setState({ customCSS: "p { color: red; }" });
    expect(guard).toThrow("发生变化");
  });
  it("rechecks operations starting after save", async () => {
    const guard = await saveBeforeUpdate(() => context, persistFile);
    useArticleTransferState.setState({ imageBusy: true });
    expect(guard).toThrow("操作尚未结束");
  });
  it("requires an article identity instead of assuming unsaved text is safe", async () => {
    useHistoryStore.setState({ activeId: null });
    await expect(saveBeforeUpdate(() => context, persistFile)).rejects.toThrow(
      "尚未关联",
    );
    expect(db.update).not.toHaveBeenCalled();
  });
  it.each(["imageBusy", "fileBusy"] as const)(
    "blocks %s before saving",
    async (key) => {
      useArticleTransferState.setState({ [key]: true });
      await expect(
        saveBeforeUpdate(() => context, persistFile),
      ).rejects.toThrow("操作尚未结束");
      expect(db.update).not.toHaveBeenCalled();
    },
  );
  it.each(["isLoading", "isRestoring", "isSaving"] as const)(
    "blocks %s",
    (key) => {
      useFileStore.setState({ [key]: true });
      expect(() => assertUpdateIdle(context)).toThrow("读取或写入");
    },
  );
  it("blocks queued browser writes and directory recovery operations", () => {
    useHistoryStore.setState({ pendingWrites: 1 });
    expect(() => assertUpdateIdle(context)).toThrow("读取或写入");
    useHistoryStore.setState({ pendingWrites: 0 });
    useDirectoryStorageState.setState({ pendingOperations: 1 });
    expect(() => assertUpdateIdle(context)).toThrow("读取或写入");
  });
  it("blocks migration/read errors and missing permissions", () => {
    useHistoryStore.setState({ error: "upgrade needed" });
    expect(() => assertUpdateIdle(context)).toThrow("存储提示");
    context.ready = false;
    expect(() => assertUpdateIdle(context)).toThrow("重新授权");
  });
  it("awaits the existing filesystem persistence path", async () => {
    context.type = "filesystem";
    useFileStore.setState({
      currentFile: {
        path: "a/index.md",
        name: "index.md",
        size: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const guard = await saveBeforeUpdate(() => context, persistFile);
    expect(persistFile).toHaveBeenCalledWith(false, true);
    expect(guard).not.toThrow();
    expect(db.update).not.toHaveBeenCalled();
  });
  it("blocks failed filesystem save and permits retry after recovery", async () => {
    context.type = "filesystem";
    useFileStore.setState({
      currentFile: {
        path: "a/index.md",
        name: "index.md",
        size: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    persistFile.mockResolvedValueOnce(false);
    await expect(saveBeforeUpdate(() => context, persistFile)).rejects.toThrow(
      "保存失败",
    );
    await expect(
      saveBeforeUpdate(() => context, persistFile),
    ).resolves.toBeTypeOf("function");
  });
  it("blocks orphan directory text and workspace changes", async () => {
    context.type = "filesystem";
    await expect(saveBeforeUpdate(() => context, persistFile)).rejects.toThrow(
      "尚未关联文件",
    );
    useEditorStore.setState({ markdown: "" });
    const guard = await saveBeforeUpdate(() => context, persistFile);
    useFileStore.setState({ workspaceRevision: 1 });
    expect(guard).toThrow("发生变化");
  });
});
