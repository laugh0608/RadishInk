import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageManager } from "../../storage/StorageManager";

const mocks = vi.hoisted(() => ({
  old: { ready: true, type: "indexeddb", init: vi.fn(), teardown: vi.fn() },
  next: { ready: true, type: "filesystem", init: vi.fn(), teardown: vi.fn() },
}));
vi.mock("../../storage/adapters/IndexedDBAdapter", () => ({
  IndexedDBAdapter: class {
    constructor() {
      return mocks.old;
    }
  },
}));
vi.mock("../../storage/adapters/FileSystemAdapter", () => ({
  FileSystemAdapter: class {
    constructor() {
      return mocks.next;
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.old.init.mockResolvedValue({ ready: true });
  mocks.next.init.mockResolvedValue({ ready: true });
});

describe("切换存储模式保留原工作区", () => {
  it("恢复时保留等待授权的适配器，不切换为浏览器空库", async () => {
    const manager = new StorageManager();
    mocks.next.init.mockResolvedValueOnce({
      ready: false,
      permissionRequired: true,
    });
    await manager.setAdapter("filesystem", {
      identifier: "synthetic",
      restore: true,
    });
    expect(manager.currentAdapter).toBe(mocks.next);
    expect(mocks.next.teardown).not.toHaveBeenCalled();
    expect(mocks.old.init).not.toHaveBeenCalled();
  });
  it.each(["cancel", "denied", "save"])(
    "%s 失败不能拆除原存储",
    async (failure) => {
      const manager = new StorageManager();
      await manager.setAdapter("indexeddb");
      if (failure === "cancel")
        mocks.next.init.mockRejectedValueOnce(
          new DOMException("取消", "AbortError"),
        );
      if (failure === "denied")
        mocks.next.init.mockResolvedValueOnce({ ready: false });
      const beforeCommit = vi.fn(async () => failure !== "save");
      if (failure === "cancel")
        await expect(
          manager.setAdapter("filesystem", undefined, beforeCommit),
        ).rejects.toThrow("取消");
      else
        expect(
          (await manager.setAdapter("filesystem", undefined, beforeCommit))
            .ready,
        ).toBe(false);
      expect(manager.currentAdapter).toBe(mocks.old);
      expect(mocks.old.teardown).not.toHaveBeenCalled();
      expect(mocks.next.teardown).toHaveBeenCalledOnce();
    },
  );

  it("初始化候选后保存旧稿，通过后才提交切换", async () => {
    const manager = new StorageManager();
    await manager.setAdapter("indexeddb");
    const beforeCommit = vi.fn(async () => {
      expect(manager.currentAdapter).toBe(mocks.old);
      return true;
    });
    await manager.setAdapter("filesystem", undefined, beforeCommit);
    expect(mocks.next.init.mock.invocationCallOrder[0]).toBeLessThan(
      beforeCommit.mock.invocationCallOrder[0],
    );
    expect(beforeCommit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.old.teardown.mock.invocationCallOrder[0],
    );
    expect(manager.currentAdapter).toBe(mocks.next);
  });
});

it("并发恢复复用同一初始化，StrictMode 重入不会拆除刚启用的适配器", async () => {
  const manager = new StorageManager();
  let finish!: (value: { ready: boolean }) => void;
  mocks.old.init.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: vi.fn() },
  });
  const first = manager.restoreLastAdapter();
  const second = manager.restoreLastAdapter();
  await vi.waitFor(() => expect(mocks.old.init).toHaveBeenCalledOnce());
  finish({ ready: true });
  expect(await first).toBe(await second);
  expect(mocks.old.teardown).not.toHaveBeenCalled();
});
