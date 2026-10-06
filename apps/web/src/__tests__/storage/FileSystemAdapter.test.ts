import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "../../storage/adapters/FileSystemAdapter";

afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker;
});

describe("FileSystemAdapter.renameFile", () => {
  it("exists 只把 NotFound 当作不存在，权限撤回不能成为覆盖依据", async () => {
    const adapter = new FileSystemAdapter();
    const getFileHandle = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("missing", "NotFoundError"))
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    Object.assign(adapter, { directoryHandle: { getFileHandle } });
    expect(await adapter.exists("new.md")).toBe(false);
    await expect(adapter.exists("existing.md")).rejects.toThrow("denied");
  });
  it("禁止跨目录重命名，避免误创建文件夹", async () => {
    const adapter = new FileSystemAdapter();
    const readSpy = vi.spyOn(adapter, "readFile").mockResolvedValue("content");
    const writeSpy = vi.spyOn(adapter, "writeFile").mockResolvedValue();
    const deleteSpy = vi.spyOn(adapter, "deleteFile").mockResolvedValue();

    await expect(
      adapter.renameFile("docs/old.md", "docs/new/name.md"),
    ).rejects.toThrow("仅支持同目录重命名");

    expect(readSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("允许同目录重命名并保留原内容", async () => {
    const adapter = new FileSystemAdapter();
    const readSpy = vi.spyOn(adapter, "readFile").mockResolvedValue("content");
    const writeSpy = vi.spyOn(adapter, "writeFile").mockResolvedValue();
    const deleteSpy = vi.spyOn(adapter, "deleteFile").mockResolvedValue();

    await adapter.renameFile("docs/old.md", "docs/new.md");

    expect(readSpy).toHaveBeenCalledWith("docs/old.md");
    expect(writeSpy).toHaveBeenCalledWith("docs/new.md", "content");
    expect(deleteSpy).toHaveBeenCalledWith("docs/old.md");
  });
});

describe("FileSystemAdapter.selectWorkspace", () => {
  it("直接选择并启用新的工作区目录", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    const directoryHandle = {
      name: "新的工作区",
      requestPermission,
    } as unknown as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn(async () => directoryHandle);
    Object.defineProperty(window, "showDirectoryPicker", {
      value: showDirectoryPicker,
      configurable: true,
    });
    const adapter = new FileSystemAdapter();

    const result = await adapter.selectWorkspace();

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(result).toEqual({
      success: true,
      workspaceName: "新的工作区",
    });
    expect(adapter.directoryName).toBe("新的工作区");
    expect(adapter.ready).toBe(true);
  });

  it("用户取消选择时保留当前工作区", async () => {
    const currentHandle = {
      name: "当前工作区",
      requestPermission: vi.fn(async () => "granted" as const),
    } as unknown as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi
      .fn<() => Promise<FileSystemDirectoryHandle>>()
      .mockResolvedValueOnce(currentHandle)
      .mockRejectedValueOnce(new DOMException("已取消", "AbortError"));
    Object.defineProperty(window, "showDirectoryPicker", {
      value: showDirectoryPicker,
      configurable: true,
    });
    const adapter = new FileSystemAdapter();

    await adapter.selectWorkspace();

    await expect(adapter.selectWorkspace()).resolves.toEqual({
      success: false,
      canceled: true,
    });
    expect(adapter.directoryName).toBe("当前工作区");
    expect(adapter.ready).toBe(true);
  });

  it("切换前保存失败时不提交候选工作区", async () => {
    const currentHandle = {
      name: "当前工作区",
      requestPermission: vi.fn(async () => "granted" as const),
    } as unknown as FileSystemDirectoryHandle;
    const nextHandle = {
      name: "候选工作区",
      requestPermission: vi.fn(async () => "granted" as const),
    } as unknown as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi
      .fn<() => Promise<FileSystemDirectoryHandle>>()
      .mockResolvedValueOnce(currentHandle)
      .mockResolvedValueOnce(nextHandle);
    Object.defineProperty(window, "showDirectoryPicker", {
      value: showDirectoryPicker,
      configurable: true,
    });
    const adapter = new FileSystemAdapter();
    const beforeCommit = vi.fn(async () => false);

    await adapter.selectWorkspace();

    await expect(adapter.selectWorkspace({ beforeCommit })).resolves.toEqual({
      success: false,
      canceled: true,
    });
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(showDirectoryPicker.mock.invocationCallOrder[1]).toBeLessThan(
      beforeCommit.mock.invocationCallOrder[0],
    );
    expect(adapter.directoryName).toBe("当前工作区");
    expect(adapter.ready).toBe(true);
  });
});
