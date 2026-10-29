import { useState } from "react";
import {
  getServerClient,
  useServerState,
} from "../../storage/server/serverClient";
import {
  broadcastSessionChange,
  downloadServerRescue,
} from "../../storage/server/privateWorkspace";
import { useStorageContext } from "../../storage/StorageContext";
import { useFileSystem } from "../../hooks/useFileSystem";
import { useFileStore } from "../../store/fileStore";
import { useEditorStore } from "../../store/editorStore";
import { useThemeStore } from "../../store/themeStore";
import { useDirectoryStorageState } from "../../store/directoryStorageState";
import { useArticleTransferState } from "../../store/articleTransferState";
import { assertUpdateIdle } from "../../pwa/saveBeforeUpdate";
import { Modal } from "../common/Modal";
import { FileSidebar } from "../Sidebar/FileSidebar";
import { ServerAccountConnections } from "./ServerAccountConnections";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
} from "../../utils/markdownFileMeta";

export function ServerWorkspacePanel() {
  const context = useStorageContext();
  const [filesOpen, setFilesOpen] = useState(false);
  const session = useServerState((s) => s.session);
  const shared = session?.accountMode === "shared";
  const issue = useDirectoryStorageState((s) => s.issue);
  const current = useFileStore((s) => s.currentFile);
  const fileBusy = useFileStore(
    (s) => s.isLoading || s.isSaving || s.isRestoring,
  );
  const storageBusy = useDirectoryStorageState((s) => s.pendingOperations > 0);
  const transferBusy = useArticleTransferState(
    (s) => s.imageBusy || s.fileBusy,
  );
  const { persistActiveFile, refreshFiles } = useFileSystem();
  const [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const disabled = busy || fileBusy || storageBusy || transferBusy;
  const problem =
    issue?.workspace === context.adapter?.getWorkspaceIdentity?.()
      ? issue
      : null;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      assertUpdateIdle(context);
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="server-workspace-panel">
      <div className="server-mobile-files">
        <button disabled={disabled} onClick={() => setFilesOpen(true)}>
          文章列表
        </button>
      </div>
      <Modal
        open={filesOpen}
        onClose={() => setFilesOpen(false)}
        title="服务器文章"
      >
        <div className="server-mobile-list">
          <FileSidebar />
        </div>
      </Modal>
      <div className="server-workspace-bar">
        <span>
          {shared
            ? "共享服务器工作区 · 无用户隔离"
            : `服务器工作区 · ${session?.user.username}`}
        </span>
        {!shared && (
          <button
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                if (!(await persistActiveFile(false, true)))
                  throw new Error("保存失败，请先导出或明确放弃当前编辑");
                assertUpdateIdle(context);
                await getServerClient().logout();
                broadcastSessionChange();
                setConfirmed(false);
              })
            }
          >
            保存并退出
          </button>
        )}
        <button onClick={downloadServerRescue}>下载当前正文</button>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          我已导出或明确放弃未保存编辑
        </label>
        {!shared && confirmed && (
          <button
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                await getServerClient().logout();
                broadcastSessionChange();
                setConfirmed(false);
              })
            }
          >
            放弃编辑并退出
          </button>
        )}
      </div>
      {shared ? (
        <p role="note">
          任何能访问此服务器的人都可以读取、修改和删除共享文章。
        </p>
      ) : (
        <ServerAccountConnections disabled={disabled} />
      )}
      {(problem || error) && (
        <div role="alert">
          <p>{error || problem?.message}</p>
          {current && (
            <div className="server-workspace-bar">
              <button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    if (!(await persistActiveFile(true, true)))
                      throw new Error("保存未成功，当前编辑仍保留");
                  })
                }
              >
                重试保存
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const adapter = context.adapter!,
                      identity = adapter.getWorkspaceIdentity?.();
                    const before = useEditorStore.getState().markdown,
                      theme = useThemeStore.getState();
                    const content = applyMarkdownFileMeta(
                      useFileStore.getState().lastSavedContent,
                      {
                        body: before,
                        title: current.title,
                        theme: theme.themeId,
                        themeName: theme.themeName,
                      },
                    );
                    const copy = await adapter.saveArticleConflictCopy!(
                      current.path,
                      content,
                    );
                    if (
                      identity !== adapter.getWorkspaceIdentity?.() ||
                      before !== useEditorStore.getState().markdown ||
                      current.path !== useFileStore.getState().currentFile?.path
                    )
                      throw new Error(
                        "副本已保存；后续编辑保留，请从列表打开副本",
                      );
                    useFileStore.setState({
                      currentFile: {
                        ...current,
                        path: copy.path,
                        name: `${copy.title}.md`,
                        title: copy.title,
                      },
                      lastSavedContent: copy.content,
                      lastSavedAt: new Date(),
                      isDirty: false,
                    });
                    useDirectoryStorageState.setState({ issue: null });
                    await refreshFiles();
                  })
                }
              >
                另存冲突副本
              </button>
              <button
                disabled={disabled || !confirmed}
                onClick={() =>
                  void run(async () => {
                    const adapter = context.adapter!,
                      identity = adapter.getWorkspaceIdentity?.(),
                      before = useEditorStore.getState().markdown;
                    const content = await adapter.readFile(current.path);
                    if (
                      identity !== adapter.getWorkspaceIdentity?.() ||
                      before !== useEditorStore.getState().markdown ||
                      current.path !== useFileStore.getState().currentFile?.path
                    ) {
                      adapter.forgetArticleRead?.(current.path);
                      throw new Error("读取期间内容发生变化，请重试");
                    }
                    const parsed = parseMarkdownFileContent(content);
                    useEditorStore.getState().setMarkdown(parsed.body);
                    useThemeStore.getState().selectTheme(parsed.theme);
                    useFileStore.setState({
                      currentFile: {
                        ...current,
                        title: parsed.title || current.title,
                      },
                      lastSavedContent: content,
                      lastSavedAt: null,
                      isDirty: false,
                      workspaceRevision:
                        useFileStore.getState().workspaceRevision + 1,
                    });
                    setConfirmed(false);
                  })
                }
              >
                放弃编辑并读取远端
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
