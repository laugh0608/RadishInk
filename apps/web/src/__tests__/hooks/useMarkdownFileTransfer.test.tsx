import {
  act,
  renderHook,
  waitFor,
  render,
  fireEvent,
  screen,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { useMarkdownFileTransfer } from "../../hooks/useMarkdownFileTransfer";
import { useFileSystem } from "../../hooks/useFileSystem";
import { useFileStore } from "../../store/fileStore";
import { useEditorStore } from "../../store/editorStore";
import { useHistoryStore } from "../../store/historyStore";
import { useThemeStore } from "../../store/themeStore";
import type { StorageAdapter } from "../../storage/StorageAdapter";
import type { HistorySnapshot } from "../../store/historyTypes";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
} from "../../utils/markdownFileMeta";
import { HistoryManager } from "../../components/History/HistoryManager";
import { MarkdownFileActions } from "../../components/Sidebar/MarkdownFileActions";
import toast from "react-hot-toast";

const mocks = vi.hoisted(() => ({
  context: {
    adapter: null as StorageAdapter | null,
    type: "indexeddb",
    ready: true,
  },
  add: vi.fn(),
  update: vi.fn(),
  load: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../storage/StorageContext", () => ({
  useStorageContext: () => mocks.context,
}));
vi.mock("../../store/historyDb", () => ({
  addHistoryToDb: mocks.add,
  updateHistoryInDb: mocks.update,
  loadHistoryFromDb: mocks.load,
}));
vi.mock("../../utils/markdownFileTransfer", async (original) => ({
  ...(await original<object>()),
  downloadMarkdownFile: mocks.download,
}));
vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const makeFile = (source = "# 导入\n", name = "导入.md"): File => {
  const bytes = new TextEncoder().encode(source);
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File;
};
const entry: HistorySnapshot = {
  id: "old",
  title: "旧文章",
  markdown: "旧正文",
  theme: "default",
  themeName: "默认主题",
  customCSS: "",
  createdAt: "2026-10-06",
  savedAt: "2026-10-06",
};
let adapter: StorageAdapter;
let disk: Map<string, string>;
let identity: object;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.add.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue([entry]);
  identity = {};
  disk = new Map();
  adapter = {
    type: "filesystem",
    name: "test",
    ready: true,
    init: vi.fn(),
    getWorkspaceIdentity: () => identity,
    listFiles: vi.fn(async () =>
      [...disk].map(([name]) => ({
        name,
        path: name,
        updatedAt: new Date().toISOString(),
      })),
    ),
    exists: vi.fn(async (path) => disk.has(path)),
    writeFile: vi.fn(async (path, content) => {
      disk.set(path, content);
    }),
    readFile: vi.fn(async (path) => disk.get(path) || ""),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
  };
  mocks.context.adapter = adapter;
  mocks.context.type = "indexeddb";
  mocks.context.ready = true;
  useFileStore.setState({
    workspacePath: "测试工作区",
    workspaceRevision: 0,
    currentFile: null,
    lastSavedContent: "",
    isDirty: false,
    isRestoring: false,
    isLoading: false,
  });
  useHistoryStore.setState({
    history: [{ ...entry }],
    activeId: "old",
    loading: false,
  });
  useEditorStore.setState({ markdown: "未保存的修改 🥕" });
  useThemeStore.setState({
    themeId: "default",
    themeName: "默认主题",
    customCSS: "",
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Web Markdown 单文件流程", () => {
  it("跨 hook 自动保存与导入前保存共用队列，较早写入不能覆盖最新内容", async () => {
    mocks.context.type = "filesystem";
    useFileStore.setState({
      currentFile: {
        name: "old.md",
        path: "old.md",
        title: "old",
        createdAt: new Date(),
        updatedAt: new Date(),
        size: 0,
      },
    });
    const writing = deferred<void>();
    vi.mocked(adapter.writeFile).mockImplementationOnce(
      async (path, content) => {
        await writing.promise;
        disk.set(path, content);
      },
    );
    const auto = renderHook(useFileSystem);
    const transfer = renderHook(useMarkdownFileTransfer);
    let saving!: Promise<void>;
    act(() => {
      saving = auto.result.current.saveFile();
    });
    await waitFor(() => expect(adapter.writeFile).toHaveBeenCalledTimes(1));
    act(() => useEditorStore.setState({ markdown: "最新输入" }));
    let importing!: Promise<void>;
    act(() => {
      importing = transfer.result.current.importFile(makeFile());
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(adapter.writeFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      writing.resolve();
      await saving;
      await importing;
    });
    expect(parseMarkdownFileContent(disk.get("old.md")!).body).toBe("最新输入");
    expect(useFileStore.getState().currentFile?.path).toBe("导入.md");
  });

  it("打开其他文件前保存失败时不得替换当前未保存内容", async () => {
    mocks.context.type = "filesystem";
    const old = {
      name: "old.md",
      path: "old.md",
      title: "old",
      createdAt: new Date(),
      updatedAt: new Date(),
      size: 0,
    };
    useFileStore.setState({ currentFile: old });
    vi.mocked(adapter.writeFile).mockRejectedValueOnce(new Error("权限撤回"));
    const { result } = renderHook(useFileSystem);
    await act(() =>
      result.current.openFile({ ...old, name: "new.md", path: "new.md" }),
    );
    expect(useEditorStore.getState().markdown).toBe("未保存的修改 🥕");
    expect(adapter.readFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().currentFile).toBe(old);
  });
  it("先保存旧稿，再创建独立文章；修改、导出和重新导入保留未知 frontmatter", async () => {
    const { result } = renderHook(useMarkdownFileTransfer);
    const source =
      "---\ntitle: 交换\nextra:\n  title: 嵌套\ntags: [a, b]\n---\n\n    缩进代码\n";
    await act(() => result.current.importFile(makeFile(source)));
    expect(mocks.update.mock.calls[0][0].markdown).toBe("未保存的修改 🥕");
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.add.mock.invocationCallOrder[0],
    );
    expect(useEditorStore.getState().markdown).toBe("    缩进代码\n");
    act(() => useEditorStore.getState().setMarkdown("最新编辑"));
    act(() => result.current.exportFile());
    const [title, content] = mocks.download.mock.calls[0];
    expect(title).toBe("交换");
    expect(content).toContain("extra:\n  title: 嵌套\ntags: [a, b]");
    expect(parseMarkdownFileContent(content).body).toBe("最新编辑");
    await act(() => result.current.importFile(makeFile(content)));
    expect(
      useHistoryStore.getState().history.map((item) => item.title),
    ).toContain("交换 (1)");
    expect(useEditorStore.getState().markdown).toBe("最新编辑");
  });

  it("空文件导入是可编辑的新文章", async () => {
    const { result } = renderHook(useMarkdownFileTransfer);
    await act(() => result.current.importFile(makeFile("", "empty.MARKDOWN")));
    expect(useEditorStore.getState().markdown).toBe("");
    expect(
      useHistoryStore
        .getState()
        .history.find((item) => item.id === useHistoryStore.getState().activeId)
        ?.title,
    ).toBe("empty");
  });

  it.each(["old", "new"])(
    "%s 文章写入失败保留旧稿且不报成功",
    async (stage) => {
      (stage === "old" ? mocks.update : mocks.add).mockRejectedValueOnce(
        new Error("QuotaExceededError"),
      );
      const { result } = renderHook(useMarkdownFileTransfer);
      await act(() => result.current.importFile(makeFile()));
      expect(useHistoryStore.getState().activeId).toBe("old");
      expect(useEditorStore.getState().markdown).toBe("未保存的修改 🥕");
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("QuotaExceededError"),
        expect.anything(),
      );
    },
  );

  it("满 30 篇时拒绝导入，不能借导入淘汰旧稿", async () => {
    useHistoryStore.setState({
      history: Array.from({ length: 30 }, (_, i) => ({
        ...entry,
        id: i ? `old${i}` : "old",
      })),
    });
    const { result } = renderHook(useMarkdownFileTransfer);
    await act(() => result.current.importFile(makeFile()));
    expect(mocks.add).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("30 篇"),
      expect.anything(),
    );
  });

  it("旧稿保存期间继续编辑时停止导入", async () => {
    const saving = deferred<void>();
    mocks.update.mockReturnValueOnce(saving.promise);
    const { result } = renderHook(useMarkdownFileTransfer);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFile(makeFile());
    });
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    act(() => useEditorStore.getState().setMarkdown("继续输入"));
    await act(async () => {
      saving.resolve();
      await pending;
    });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(useEditorStore.getState().markdown).toBe("继续输入");
  });

  it("新文章写入期间继续输入：列表保留新文章，当前稿不切换", async () => {
    const writing = deferred<void>();
    mocks.add.mockReturnValueOnce(writing.promise);
    const { result } = renderHook(useMarkdownFileTransfer);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFile(makeFile());
    });
    await waitFor(() => expect(mocks.add).toHaveBeenCalled());
    act(() => useEditorStore.getState().setMarkdown("最后输入"));
    await act(async () => {
      writing.resolve();
      await pending;
    });
    expect(useEditorStore.getState().markdown).toBe("最后输入");
    expect(useHistoryStore.getState().activeId).toBe("old");
    expect(useHistoryStore.getState().history).toHaveLength(2);
  });

  it.each(["revision", "handle", "adapter", "article"])(
    "读取期间切换 %s 取消导入",
    async (kind) => {
      const reading = deferred<ArrayBuffer>();
      const { result, rerender } = renderHook(useMarkdownFileTransfer);
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.importFile({
          ...makeFile(),
          arrayBuffer: () => reading.promise,
        } as File);
      });
      act(() => {
        if (kind === "revision")
          useFileStore.getState().bumpWorkspaceRevision();
        if (kind === "handle") identity = {};
        if (kind === "adapter") mocks.context.adapter = { ...adapter };
        if (kind === "article") useHistoryStore.setState({ activeId: "other" });
        rerender();
      });
      await act(async () => {
        reading.resolve(new TextEncoder().encode("new").buffer);
        await pending;
      });
      expect(mocks.add).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(adapter.writeFile).not.toHaveBeenCalled();
    },
  );

  it("选择器打开期间切换工作区后不得写入新工作区", async () => {
    const { result } = renderHook(useMarkdownFileTransfer);
    act(() => result.current.beginImport());
    act(() => useFileStore.getState().bumpWorkspaceRevision());
    await act(() => result.current.importFile(makeFile()));
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("目录同名递增且保存当前未标 dirty 的编辑", async () => {
    mocks.context.type = "filesystem";
    disk.set("导入.md", "existing");
    useFileStore.setState({
      currentFile: {
        name: "old.md",
        path: "old.md",
        title: "old",
        createdAt: new Date(),
        updatedAt: new Date(),
        size: 0,
      },
      lastSavedContent: "old",
    });
    const { result } = renderHook(useMarkdownFileTransfer);
    await act(() => result.current.importFile(makeFile()));
    expect(disk.get("导入.md")).toBe("existing");
    expect(disk.get("old.md")).toContain("未保存的修改 🥕");
    expect(disk.get("导入 (1).md")).toContain("# 导入");
    expect(useFileStore.getState().currentFile?.path).toBe("导入 (1).md");
  });

  it("目录权限撤回停止导入，不吞 exists 的权限错误", async () => {
    mocks.context.type = "filesystem";
    useEditorStore.setState({ markdown: "" });
    vi.mocked(adapter.exists).mockRejectedValueOnce(
      new DOMException("权限已撤回", "NotAllowedError"),
    );
    const { result } = renderHook(useMarkdownFileTransfer);
    await act(() => result.current.importFile(makeFile()));
    expect(adapter.writeFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("权限已撤回"),
      expect.anything(),
    );
  });

  it("目录写入期间切换目录，晚到结果不覆盖新工作区编辑器", async () => {
    mocks.context.type = "filesystem";
    useEditorStore.setState({ markdown: "" });
    const writing = deferred<void>();
    vi.mocked(adapter.writeFile).mockReturnValueOnce(writing.promise);
    const { result } = renderHook(useMarkdownFileTransfer);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFile(makeFile());
    });
    await waitFor(() => expect(adapter.writeFile).toHaveBeenCalled());
    act(() => {
      identity = {};
      useEditorStore.setState({ markdown: "新工作区" });
    });
    await act(async () => {
      writing.resolve();
      await pending;
    });
    expect(useEditorStore.getState().markdown).toBe("新工作区");
    expect(adapter.listFiles).not.toHaveBeenCalled();
    expect(useFileStore.getState().currentFile).toBeNull();
  });

  it("取消与重复点击不新建多篇；文件输入重置后可再次选择同一文件", async () => {
    render(<MarkdownFileActions />);
    const input = screen.getByLabelText("选择 Markdown 文件");
    fireEvent.change(input, { target: { files: [] } });
    expect(mocks.add).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "导入 Markdown" }),
      ).toBeEnabled(),
    );
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(2));
  });

  it("导出失败提示但不更改编辑器或调用保存", () => {
    mocks.download.mockImplementationOnce(() => {
      throw new Error("下载资源不可用");
    });
    const { result } = renderHook(useMarkdownFileTransfer);
    act(() => result.current.exportFile());
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("下载资源不可用"),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(useEditorStore.getState().markdown).toBe("未保存的修改 🥕");
  });

  it("HistoryManager 恢复完整源文件的正文，迟到保存不回滚继续输入", async () => {
    const imported = {
      ...entry,
      markdown: applyMarkdownFileMeta("---\nextra: keep\n---\n\n内容", {
        title: "旧文章",
      }),
    };
    mocks.load.mockResolvedValue([imported]);
    render(<HistoryManager />);
    await waitFor(() =>
      expect(useEditorStore.getState().markdown).toBe("内容"),
    );
    act(() => useEditorStore.setState({ markdown: "第一次编辑" }));
    const saving = deferred<void>();
    mocks.update.mockReturnValueOnce(saving.promise);
    const pending = useHistoryStore.getState().persistActiveSnapshot({
      markdown: "第一次编辑",
      theme: "default",
      themeName: "默认主题",
      customCSS: "",
    });
    act(() => useEditorStore.setState({ markdown: "最后的编辑" }));
    await act(async () => {
      saving.resolve();
      await pending;
    });
    expect(useEditorStore.getState().markdown).toBe("最后的编辑");
    expect(mocks.update.mock.calls[0][0].markdown).toContain("extra: keep");
  });
});
