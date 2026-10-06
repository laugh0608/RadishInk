import type { StorageAdapter } from "../storage/StorageAdapter";
import { useFileStore } from "../store/fileStore";

/** 捕获实际目录身份，避免目录提交到 React 更新之间的异步窗口串写。 */
export function captureWorkspace(adapter: StorageAdapter | null) {
  const { workspacePath, workspaceRevision } = useFileStore.getState();
  const identity = adapter?.getWorkspaceIdentity?.();
  return () => {
    const current = useFileStore.getState();
    return (
      adapter?.ready !== false &&
      current.workspacePath === workspacePath &&
      current.workspaceRevision === workspaceRevision &&
      adapter?.getWorkspaceIdentity?.() === identity
    );
  };
}
