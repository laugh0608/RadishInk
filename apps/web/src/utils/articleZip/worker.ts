import { decodeArticleZip, encodeArticleZip, type ArticleZip } from "./codec";
self.onmessage = (
  event: MessageEvent<
    | { mode: "encode"; value: ArticleZip }
    | { mode: "decode"; value: Uint8Array }
  >,
) => {
  try {
    const progress = (value: number) => self.postMessage({ progress: value });
    const result =
      event.data.mode === "encode"
        ? encodeArticleZip(event.data.value, progress)
        : decodeArticleZip(event.data.value, progress);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
