import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runZipWorker } from "../../utils/articleZip/client";
class WorkerStub {
  static last: WorkerStub;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    WorkerStub.last = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", WorkerStub);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("文章包 Worker 生命周期", () => {
  it("进度不提前成功，结果返回后终止 Worker 并清除超时", async () => {
    const progress = vi.fn();
    const task = runZipWorker(
      "decode",
      new Uint8Array([1]),
      new AbortController().signal,
      progress,
    );
    const worker = WorkerStub.last;
    worker.onmessage?.({ data: { progress: 50 } });
    expect(progress).toHaveBeenCalledWith(50);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.onmessage?.({ data: { result: { root: "a", entries: [] } } });
    expect(await task).toEqual({ root: "a", entries: [] });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["cancel", "timeout", "error"])(
    "%s 终止 Worker，释放定时器并拒绝结果",
    async (kind) => {
      const controller = new AbortController();
      const task = runZipWorker(
        "decode",
        new Uint8Array([1]),
        controller.signal,
        vi.fn(),
      );
      const rejected = expect(task).rejects.toThrow();
      if (kind === "cancel") controller.abort();
      else if (kind === "timeout") vi.advanceTimersByTime(30_001);
      else WorkerStub.last.onerror?.();
      await rejected;
      expect(WorkerStub.last.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
