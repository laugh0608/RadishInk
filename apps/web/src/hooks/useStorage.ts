import { useCallback, useEffect, useMemo, useState } from "react";
import type { StorageAdapter } from "../storage/StorageAdapter";
import { StorageManager } from "../storage/StorageManager";
import type { StorageType } from "../storage/types";
import { getRuntimeConfig } from "../storage/server/runtimeConfig";
import { useServerState } from "../storage/server/serverClient";

export function useStorage() {
  const [manager] = useState(() => new StorageManager());
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [type, setType] = useState<StorageType>(() =>
    getRuntimeConfig().deployment === "server" ? "server" : "indexeddb",
  );
  const session = useServerState((s) => s.session);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    manager
      .restoreLastAdapter()
      .then((instance) => {
        if (instance) {
          setAdapter(instance);
          setType(instance.type);
          setReady(instance.ready);
          setMessage(
            instance.type === "filesystem"
              ? instance.ready
                ? "已启用本地文件夹模式"
                : "文件夹需要重新授权，请点击重新授权原文件夹或重新选择目录"
              : instance.type === "server"
                ? "服务器工作区需有效的本站会话"
                : "已启用浏览器存储模式",
          );
        }
      })
      .catch((error) => {
        setMessage(error.message);
      });
  }, [manager]);

  const select = useCallback(
    async (nextType: StorageType, beforeCommit?: () => Promise<boolean>) => {
      const result = await manager.setAdapter(
        nextType,
        undefined,
        beforeCommit,
      );
      if (result.ready) {
        setAdapter(manager.currentAdapter);
        setType(nextType);
        setReady(true);
        setMessage(
          nextType === "filesystem"
            ? "已切换到本地文件夹模式"
            : nextType === "server"
              ? "已切换到服务器工作区"
              : "已切换到浏览器存储模式",
        );
      } else {
        setMessage(result.message ?? "初始化失败，请重试");
      }
      return result;
    },
    [manager],
  );

  const reauthorize = useCallback(async () => {
    if (!adapter?.requestWorkspacePermission)
      throw new Error("当前存储不支持目录授权");
    const result = await adapter.requestWorkspacePermission();
    // 已加载工作区撤权时，不切换 ready，避免清空未保存编辑。
    if (result.ready) setReady(true);
    setMessage(result.message ?? "");
    return result;
  }, [adapter]);

  return useMemo(
    () => ({
      adapter,
      type,
      ready: type === "server" ? !!adapter?.ready && !!session : ready,
      message,
      select,
      reauthorize,
      isFileSystemSupported: StorageManager.isFileSystemSupported(),
    }),
    [adapter, message, ready, select, reauthorize, type, session],
  );
}
