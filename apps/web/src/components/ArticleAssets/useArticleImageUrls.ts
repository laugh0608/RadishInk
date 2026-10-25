import { useEffect, useState } from "react";
import { useArticleWorkspace } from "./ArticleWorkspaceContext";
import { inspectImage, IMAGE_LIMITS } from "./imagePolicy";

const empty = new Map<string, string>();
export function useArticleImageUrls() {
  const workspace = useArticleWorkspace();
  const [resolved, setResolved] = useState<{
    workspace: typeof workspace;
    urls: Map<string, string>;
  }>({ workspace: null, urls: empty });
  useEffect(() => {
    let canceled = false;
    const urls = new Map<string, string>();
    void (async () => {
      for (const asset of workspace?.assets ?? []) {
        if (canceled) return;
        try {
          if (asset.bytes.size > IMAGE_LIMITS.bytes) continue;
          const bytes = await asset.bytes.arrayBuffer();
          if (canceled) return;
          const info = inspectImage(new Uint8Array(bytes));
          urls.set(
            asset.path,
            URL.createObjectURL(new Blob([bytes], { type: info.type })),
          );
        } catch {
          /* 损坏或不支持的资源由预览列为缺失；不替换源文、不发 HTTP 请求。 */
        }
      }
      if (!canceled) setResolved({ workspace, urls });
    })();
    return () => {
      canceled = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [workspace]);
  return resolved.workspace === workspace ? resolved.urls : empty;
}
