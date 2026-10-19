import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "../../storage/adapters/FileSystemAdapter";

afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker;
});

describe("目录权限恢复", () => {
  it("页面启动只查询权限，等待用户手势，不弹选择器也不请求授权", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    const queryPermission = vi.fn(async () => "prompt" as const);
    const handle = { name: "合成目录", requestPermission, queryPermission };
    const picker = vi.fn();
    Object.defineProperty(window, "showDirectoryPicker", {
      value: picker,
      configurable: true,
    });
    const adapter = new FileSystemAdapter();
    Object.assign(adapter, { directoryHandle: handle });
    expect(await adapter.init({ restore: true })).toMatchObject({
      ready: false,
      permissionRequired: true,
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(picker).not.toHaveBeenCalled();
    expect(await adapter.requestWorkspacePermission()).toMatchObject({
      ready: true,
    });
    expect(adapter.getWorkspaceIdentity()).toBe(handle);
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("缺少持久句柄时启动不打开选择器", async () => {
    const picker = vi.fn();
    Object.defineProperty(window, "showDirectoryPicker", {
      value: picker,
      configurable: true,
    });
    const adapter = new FileSystemAdapter();
    expect(await adapter.init({ restore: true })).toMatchObject({
      ready: false,
      permissionRequired: true,
    });
    expect(picker).not.toHaveBeenCalled();
  });

  it("拒绝重新授权仍保留原句柄和已读基线", async () => {
    Object.defineProperty(window, "showDirectoryPicker", {
      value: vi.fn(),
      configurable: true,
    });
    const handle = { requestPermission: vi.fn(async () => "denied" as const) };
    const reads = new Map([["旧文.md", "合成正文"]]);
    const adapter = new FileSystemAdapter();
    Object.assign(adapter, { directoryHandle: handle, legacyRead: reads });
    expect(await adapter.requestWorkspacePermission()).toMatchObject({
      ready: false,
    });
    expect(adapter.getWorkspaceIdentity()).toBe(handle);
    expect(reads.get("旧文.md")).toBe("合成正文");
  });
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
