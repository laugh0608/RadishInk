import type { ArticleZip } from "./codec";
export function runZipWorker(
  mode: "encode",
  value: ArticleZip,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<Uint8Array>;
export function runZipWorker(
  mode: "decode",
  value: Uint8Array,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<ArticleZip>;
export function runZipWorker(
  mode: "encode" | "decode",
  value: ArticleZip | Uint8Array,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<ArticleZip | Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const cancel = () => fail(new Error("文章包处理已取消"));
    const timer = window.setTimeout(
      () => fail(new Error("文章包处理超过 30 秒，请缩小后重试")),
      30_000,
    );
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => fail(new Error("文章包处理进程异常，请重试"));
    worker.onmessage = (event) => {
      if (event.data.error) fail(new Error(event.data.error));
      else if (event.data.result !== undefined) {
        cleanup();
        resolve(event.data.result);
      } else progress(event.data.progress);
    };
    try {
      worker.postMessage({ mode, value });
    } catch (error) {
      fail(error);
    }
  });
}
