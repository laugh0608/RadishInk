import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileSidebar } from "../../components/Sidebar/FileSidebar";

const mocks = vi.hoisted(() => {
  const refreshFiles = vi.fn();

  const sidebarState = {
    files: [],
    currentFile: null,
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    deleteFolder: vi.fn(),
    selectWorkspace: vi.fn(),
    workspacePath: "/workspace",
    workspaceRevision: 0,
    flattenFiles: vi.fn(() => []),
    refreshFiles,
    allFolders: [],
    filteredItems: [],
    isDragEnabled: true,
    filter: "",
    setFilter: vi.fn(),
    renamingPath: null,
    setRenamingPath: vi.fn(),
    renameValue: "",
    setRenameValue: vi.fn(),
    collapsedFolders: new Set<string>(),
    menuOpen: false,
    menuPos: { x: 0, y: 0 },
    menuTarget: null,
    menuTargetFolder: null,
    deleteTarget: null,
    setDeleteTarget: vi.fn(),
    deleteFolderTarget: null,
    setDeleteFolderTarget: vi.fn(),
    deleteFolderExtras: [],
    setDeleteFolderExtras: vi.fn(),
    deleting: false,
    setDeleting: vi.fn(),
    showNewFolderModal: false,
    setShowNewFolderModal: vi.fn(),
    newFolderName: "",
    setNewFolderName: vi.fn(),
    activeFolder: null,
    setActiveFolder: vi.fn(),
    showMoveMenu: false,
    setShowMoveMenu: vi.fn(),
    draggingPath: null,
    setDraggingPath: vi.fn(),
    draggingFolderPath: null,
    setDraggingFolderPath: vi.fn(),
    dragOverTarget: null,
    setDragOverTarget: vi.fn(),
    tooltip: null,
    renameFolderTarget: null,
    setRenameFolderTarget: vi.fn(),
    renameFolderValue: "",
    setRenameFolderValue: vi.fn(),
    showRenameFolderModal: false,
    setShowRenameFolderModal: vi.fn(),
    sortMode: "recent",
    handleSetSortMode: vi.fn(),
    toggleFolder: vi.fn(),
    getFolderMoveTargets: vi.fn(() => []),
    closeMenu: vi.fn(),
    handleContextMenu: vi.fn(),
    handleFolderContextMenu: vi.fn(),
    handleEmptyContextMenu: vi.fn(),
    startRename: vi.fn(),
    copyTitle: vi.fn(),
    submitRename: vi.fn(),
    handleCreateFolder: vi.fn(),
    handleMoveToFolder: vi.fn(),
    handleMoveFolder: vi.fn(),
    handleRenameFolder: vi.fn(),
    closeRenameFolderModal: vi.fn(),
    prepareDeleteFolder: vi.fn(),
    showTooltip: vi.fn(),
    hideTooltip: vi.fn(),
    handleDropToFolder: vi.fn(),
    handleDropToRoot: vi.fn(),
    handleDragLeave: vi.fn(),
    handleFileClick: vi.fn(),
    formatTime: vi.fn(() => "刚刚"),
  };

  return { refreshFiles, sidebarState };
});

vi.mock("../../components/Sidebar/useSidebarState", async () => {
  const actual = await vi.importActual<
    typeof import("../../components/Sidebar/useSidebarState")
  >("../../components/Sidebar/useSidebarState");
  return {
    ...actual,
    useSidebarState: () => mocks.sidebarState,
  };
});

vi.mock("../../components/Sidebar/SidebarFooter", () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}));

vi.mock("../../store/themeStore", () => ({
  useThemeStore: () => "默认主题",
}));

describe("FileSidebar 刷新入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarState.workspacePath = "/workspace";
    mocks.sidebarState.workspaceRevision = 0;
  });

  it("点击刷新按钮会触发文件列表刷新", () => {
    render(<FileSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "刷新文件列表" }));

    expect(mocks.refreshFiles).toHaveBeenCalledTimes(1);
  });

  it("点击主操作会在当前层级新建文章", () => {
    render(<FileSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "新建文章" }));

    expect(mocks.sidebarState.createFile).toHaveBeenCalledWith(undefined);
  });

  it("将刷新和新建文件夹放在紧凑工具栏中", () => {
    render(<FileSidebar />);

    const refreshButton = screen.getByRole("button", {
      name: "刷新文件列表",
    });
    const newFolderButton = screen.getByRole("button", { name: "新建文件夹" });
    const searchButton = screen.getByRole("button", { name: "搜索文件" });

    expect(refreshButton.closest(".fs-actions")).toBe(
      newFolderButton.closest(".fs-actions"),
    );
    expect(searchButton.closest(".fs-quick-actions")).not.toBeNull();
    expect(searchButton.closest(".fs-quick-actions")?.lastElementChild).toBe(
      searchButton,
    );

    fireEvent.click(newFolderButton);

    expect(mocks.sidebarState.setShowNewFolderModal).toHaveBeenCalledWith(true);
  });

  it("只显示一次工作区名称，并将上方名称作为根目录入口", () => {
    render(<FileSidebar />);

    expect(screen.getAllByText("workspace")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "workspace" }));

    expect(mocks.sidebarState.setActiveFolder).toHaveBeenCalledWith(null);
  });

  it("保留独立的工作区切换入口", () => {
    render(<FileSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "切换工作区" }));

    expect(mocks.sidebarState.selectWorkspace).toHaveBeenCalledTimes(1);
  });

  it("排序入口向辅助技术同步菜单展开状态", () => {
    render(<FileSidebar />);

    const sortButton = screen.getByRole("button", { name: "排序方式" });
    expect(sortButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(sortButton);

    expect(sortButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("排序菜单只用对勾标记当前选项", () => {
    render(<FileSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "排序方式" }));

    const selectedOption = screen.getByRole("button", { name: "最近编辑" });
    expect(selectedOption).toHaveClass("fs-sort-option");
    expect(selectedOption).not.toHaveClass("active");
    expect(selectedOption.querySelector("svg")).not.toBeNull();
  });

  it("按需展开搜索并在收起时清空筛选", () => {
    render(<FileSidebar />);

    expect(screen.queryByRole("searchbox", { name: "搜索文件" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "搜索文件" }));

    const input = screen.getByRole("searchbox", { name: "搜索文件" });
    fireEvent.change(input, { target: { value: "周报" } });
    expect(mocks.sidebarState.setFilter).toHaveBeenCalledWith("周报");

    fireEvent.click(screen.getByRole("button", { name: "收起搜索" }));
    expect(mocks.sidebarState.setFilter).toHaveBeenLastCalledWith("");
    expect(screen.queryByRole("searchbox", { name: "搜索文件" })).toBeNull();
  });

  it("切换工作区时会收起旧工作区的搜索框", async () => {
    const { rerender } = render(<FileSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "搜索文件" }));
    expect(screen.getByRole("searchbox", { name: "搜索文件" })).not.toBeNull();

    mocks.sidebarState.workspacePath = "/another-workspace";
    rerender(<FileSidebar />);

    expect(
      await screen.findByRole("button", { name: "搜索文件" }),
    ).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "搜索文件" })).toBeNull();
  });

  it("切换到同名工作区时也会收起搜索框", async () => {
    const { rerender } = render(<FileSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "搜索文件" }));
    expect(screen.getByRole("searchbox", { name: "搜索文件" })).not.toBeNull();

    mocks.sidebarState.workspaceRevision = 1;
    rerender(<FileSidebar />);

    expect(
      await screen.findByRole("button", { name: "搜索文件" }),
    ).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "搜索文件" })).toBeNull();
  });
});
