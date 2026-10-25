/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useStorageContext } from "../../storage/StorageContext";
import { useHistoryStore } from "../../store/historyStore";
import { getHistoryAssets } from "../../store/historyDb";
import { useFileStore } from "../../store/fileStore";
import type { ArticleAsset } from "../../storage/articles/articleContract";
import { platform } from "../../lib/platformAdapter";

export interface ArticleImageTarget {
  assets: ArticleAsset[];
  append: (assets: ArticleAsset[]) => Promise<void>;
  isCurrent: () => boolean;
}
export interface ArticleWorkspace {
  capture: () => ArticleImageTarget;
  assets: ArticleAsset[];
  error: string;
  identity: object;
  revision: number;
}
export const ArticleWorkspaceContext = createContext<ArticleWorkspace | null>(
  null,
);
export const useArticleWorkspace = () => useContext(ArticleWorkspaceContext);

export function ArticleWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { adapter, ready, type } = useStorageContext();
  const activeId = useHistoryStore((s) => s.activeId);
  const history = useHistoryStore((s) => s.history);
  const file = useFileStore((s) => s.currentFile);
  const workspaceRevision = useFileStore((s) => s.workspaceRevision);
  const [assetRevision, setAssetRevision] = useState(0);
  const identity = useMemo(
    () => ({ adapter, type, activeId, path: file?.path, workspaceRevision }),
    [adapter, type, activeId, file?.path, workspaceRevision],
  );
  const value = useMemo<ArticleWorkspace>(() => {
    let assets: ArticleAsset[] = [];
    let error = "";
    const root = adapter?.getWorkspaceIdentity?.();
    const isCurrent = () =>
      type === "indexeddb"
        ? useHistoryStore.getState().activeId === activeId
        : adapter?.getWorkspaceIdentity?.() === root &&
          useFileStore.getState().currentFile?.path === file?.path &&
          useFileStore.getState().workspaceRevision === workspaceRevision;
    try {
      if (!ready || platform.isElectron)
        throw new Error("请先启用可用的 Web 文章存储");
      if (type === "indexeddb") {
        if (!activeId || !history.some((row) => row.id === activeId))
          throw new Error("请先新建或打开一篇文章");
        assets = getHistoryAssets(activeId);
      } else {
        if (!file?.articlePackage || !adapter?.getArticleAssets)
          throw new Error(
            "请先新建文章；旧单文件请从“目录维护与恢复”复制为文章目录后打开，原件保留",
          );
        assets = adapter.getArticleAssets(file.path);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    return {
      revision: assetRevision,
      identity,
      assets,
      error,
      capture() {
        if (error) throw new Error(error);
        return {
          assets,
          isCurrent,
          async append(additions) {
            if (!isCurrent())
              throw new Error("文章或工作区已切换，图片插入已取消");
            if (type === "indexeddb")
              await useHistoryStore
                .getState()
                .appendAssets(activeId!, additions);
            else await adapter!.appendArticleAssets!(file!.path, additions);
            setAssetRevision((value) => value + 1);
          },
        };
      },
    };
  }, [
    adapter,
    ready,
    type,
    activeId,
    history,
    file,
    workspaceRevision,
    assetRevision,
    identity,
  ]);
  return (
    <ArticleWorkspaceContext.Provider value={value}>
      {children}
    </ArticleWorkspaceContext.Provider>
  );
}
