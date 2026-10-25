import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useDirectoryStorageState } from "../../store/directoryStorageState";
import { downloadMarkdownFile } from "../../utils/markdownFileTransfer";
import { applyMarkdownFileMeta } from "../../utils/markdownFileMeta";

export function downloadServerRescue() {
  const file = useFileStore.getState();
  downloadMarkdownFile(
    file.currentFile?.title || "未保存正文",
    applyMarkdownFileMeta(file.lastSavedContent, {
      body: useEditorStore.getState().markdown,
    }),
  );
}

/** 服务器正文只存在当前工作区内存；切换前同步清除，避免历史管理器首次挂载捕获旧正文。 */
export function clearPrivateWorkspace() {
  useEditorStore.setState({
    markdown: "",
    currentFilePath: undefined,
    workspaceDir: undefined,
    lastAutoSavedAt: null,
    isEditing: false,
  });
  useFileStore.setState((s) => ({
    files: [],
    currentFile: null,
    lastSavedContent: "",
    lastSavedAt: null,
    isDirty: false,
    isLoading: false,
    isSaving: false,
    isRestoring: false,
    workspacePath: null,
    workspaceRevision: s.workspaceRevision + 1,
  }));
  useDirectoryStorageState.setState({ issue: null });
}

const CHANNEL = "radishink-session-change";
// 同一页面也会收到另一个 BroadcastChannel 实例发出的消息。
const source = crypto.randomUUID();
export function broadcastSessionChange() {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: "changed", source });
    channel.close();
  }
  try {
    localStorage.setItem(CHANNEL, crypto.randomUUID());
  } catch {
    /* BroadcastChannel 仍可通知。 */
  }
}
export function listenSessionChange(listener: () => void) {
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(CHANNEL)
      : null;
  if (channel)
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.source !== source) listener();
    };
  const storage = (event: StorageEvent) => {
    if (event.key === CHANNEL) listener();
  };
  window.addEventListener("storage", storage);
  return () => {
    channel?.close();
    window.removeEventListener("storage", storage);
  };
}
