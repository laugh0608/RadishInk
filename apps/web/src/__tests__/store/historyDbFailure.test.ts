import { describe, expect, it, vi } from "vitest";
import type { HistorySnapshot } from "../../store/historyTypes";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("idb", () => ({ openDB: mocks.open }));

describe("历史保存必须等待事务提交并报告错误", () => {
  it.each(["addHistoryToDb", "updateHistoryInDb"] as const)(
    "%s 不能把事务中止当成功",
    async (method) => {
      vi.resetModules();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      let reject!: (error: Error) => void;
      const done = new Promise<void>((_, r) => {
        reject = r;
      });
      const store = {
        put: vi.fn(async () => {}),
        getAll: vi.fn(async () => []),
        delete: vi.fn(),
      };
      mocks.open.mockResolvedValue({ transaction: () => ({ store, done }) });
      const db = await import("../../store/historyDb");
      const pending = db[method]({
        id: "synthetic",
        markdown: "内容",
      } as HistorySnapshot);
      const assertion = expect(pending).rejects.toThrow("quota");
      reject(new Error("quota"));
      await assertion;
      expect(store.put).toHaveBeenCalledOnce();
      errorLog.mockRestore();
    },
  );
});
