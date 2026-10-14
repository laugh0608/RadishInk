import { useState } from "react";
import toast from "react-hot-toast";
import { Modal } from "../common/Modal";
import { useStorageContext } from "../../storage/StorageContext";
import { useFileStore } from "../../store/fileStore";
import { useEditorStore } from "../../store/editorStore";
import { useThemeStore } from "../../store/themeStore";
import { useDirectoryStorageState } from "../../store/directoryStorageState";
import { useFileSystem } from "../../hooks/useFileSystem";
import {
  convertAdapterFilesToTreeItems,
  flattenFiles,
} from "../../hooks/useFileSystemHelpers";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
} from "../../utils/markdownFileMeta";
import { downloadMarkdownFile } from "../../utils/markdownFileTransfer";
import type { DirectoryOperationSummary } from "../../storage/articles/directoryPackageOperations";
import type { FileItem } from "../../store/fileTypes";
import "./HistoryStorageNotice.css";

export function DirectoryStoragePanel() {
  const { adapter } = useStorageContext();
  const issue = useDirectoryStorageState((s) => s.issue);
  const current = useFileStore((s) => s.currentFile);
  const { persistActiveFile, refreshFiles } = useFileSystem();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [operations, setOperations] = useState<DirectoryOperationSummary[]>([]);
  if (!adapter?.createArticle) return null;
  const workspace = adapter.getWorkspaceIdentity?.();
  const problem = issue?.workspace === workspace ? issue : null;
  const refresh = async () => {
    const rows = await adapter.listFiles();
    if (adapter.getWorkspaceIdentity?.() !== workspace) return;
    setFiles(flattenFiles(convertAdapterFilesToTreeItems(rows)));
    setOperations(await adapter.listArticleOperations!());
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (adapter.getWorkspaceIdentity?.() !== workspace)
        throw new Error("工作区已变化，请重新打开维护入口");
      await action();
      if (adapter.getWorkspaceIdentity?.() === workspace) {
        await refresh();
        await refreshFiles();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const state = useFileStore.getState();
    const theme = useThemeStore.getState();
    downloadMarkdownFile(
      state.currentFile?.title || "未保存正文",
      applyMarkdownFileMeta(state.lastSavedContent, {
        body: useEditorStore.getState().markdown,
        title: state.currentFile?.title || "未保存正文",
        theme: theme.themeId,
        themeName: theme.themeName,
      }),
    );
  };
  const reopen = async () => {
    if (!current) return;
    const before = useEditorStore.getState().markdown;
    const theme = useThemeStore.getState().themeId;
    if (useFileStore.getState().isDirty && !confirmed)
      throw new Error("请先下载当前正文并确认，再重新读取磁盘版本");
    const content = await adapter.readFile(current.path);
    if (
      adapter.getWorkspaceIdentity?.() !== workspace ||
      useFileStore.getState().currentFile?.path !== current.path ||
      useEditorStore.getState().markdown !== before ||
      useThemeStore.getState().themeId !== theme
    ) {
      adapter.forgetArticleRead?.(current.path);
      throw new Error("读取期间编辑或工作区发生变化，已保留编辑，请重试");
    }
    const parsed = parseMarkdownFileContent(content);
    useEditorStore.getState().setMarkdown(parsed.body);
    useThemeStore.getState().selectTheme(parsed.theme);
    useFileStore.setState({
      currentFile: { ...current, title: parsed.title || current.title },
      lastSavedContent: content,
      lastSavedAt: null,
      isDirty: false,
    });
    useDirectoryStorageState.setState({ issue: null });
    setConfirmed(false);
  };
  return (
    <>
      <div
        className="history-storage-notice"
        role={problem ? "alert" : undefined}
      >
        <span>
          {problem
            ? `目录操作未完成：${problem.message}`
            : "文件夹模式：新建与导入按文章目录保存，旧 Markdown 保留原位。"}
        </span>
        <button
          onClick={() => {
            setOpen(true);
            void run(refresh);
          }}
        >
          目录维护与恢复
        </button>
        {problem && <button onClick={download}>下载当前正文</button>}
      </div>
      <Modal
        closeDisabled={busy}
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="目录维护与恢复"
      >
        <div className="history-storage-actions">
          <p>
            正文和 asset/
            一起保存。写入中断可重试恢复；发生外部修改时保留磁盘内容、当前编辑和日志，不自动覆盖。
          </p>
          {problem && (
            <p role="alert">
              {problem.path}：{problem.message}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} onClick={() => void run(refresh)}>
            刷新目录状态
          </button>
          {current && (
            <>
              <p>当前文章：{current.title || current.name}</p>
              <button onClick={download}>下载当前正文</button>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我已保存当前正文，允许用磁盘版本替换编辑器内容
              </label>
              <button
                disabled={busy || !confirmed}
                onClick={() => void run(reopen)}
              >
                重新读取当前文章
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!(await persistActiveFile(true, true)))
                      throw new Error("保存尚未成功，请保留当前编辑并处理错误");
                  })
                }
              >
                重试保存当前文章
              </button>
              {
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const before = useEditorStore.getState().markdown;
                      const theme = useThemeStore.getState();
                      const source = useFileStore.getState().lastSavedContent;
                      const copy = await adapter.saveArticleConflictCopy!(
                        current.path,
                        applyMarkdownFileMeta(source, {
                          body: before,
                          theme: theme.themeId,
                          themeName: theme.themeName,
                          title: current.title,
                        }),
                      );
                      if (
                        adapter.getWorkspaceIdentity?.() !== workspace ||
                        useFileStore.getState().currentFile?.path !==
                          current.path ||
                        useEditorStore.getState().markdown !== before ||
                        useThemeStore.getState().themeId !== theme.themeId
                      ) {
                        toast.success(
                          "副本已保存到原工作区；后续编辑保留，请稍后从列表打开",
                        );
                        return;
                      }
                      useFileStore.setState({
                        currentFile: {
                          ...current,
                          articlePackage: true,
                          path: copy.path,
                          title: copy.title,
                          name: `${copy.title}.md`,
                        },
                        lastSavedContent: copy.content,
                        lastSavedAt: new Date(),
                        isDirty: false,
                      });
                      try {
                        localStorage.setItem("wemd-last-file-path", copy.path);
                      } catch {
                        /* 不影响已持久化副本。 */
                      }
                      useDirectoryStorageState.setState({ issue: null });
                      toast.success("已保存并切换到冲突副本，原包保留");
                    })
                  }
                >
                  另存当前编辑并切换副本
                </button>
              }
              {!current.articlePackage && (
                <>
                  <p>
                    复制旧文会保留原件及旁边的所有文件；只复制
                    Markdown，已有相对图片不会自动导入。
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!(await persistActiveFile(false, true)))
                          throw new Error("请先保存当前文章");
                        if (adapter.getWorkspaceIdentity?.() !== workspace)
                          throw new Error("工作区已变化，请重新操作");
                        const path = await adapter.copyLegacyArticle!(
                          current.path,
                        );
                        toast.success(`副本已保存：${path}，请从列表打开`);
                      })
                    }
                  >
                    复制为文章目录
                  </button>
                </>
              )}
            </>
          )}
          <h4>文章写入与日志</h4>
          <p>
            清理已提交日志会删除该文章的旧写入恢复记录及暂存资源，不删除当前正文和
            asset/。未完成或无法识别的日志保留。
          </p>
          {files
            .filter((f) => f.articlePackage)
            .map((file) => (
              <div key={file.path} className="directory-maintenance-item">
                <strong>{file.title}</strong>
                <small>{file.path}</small>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await adapter.recoverArticle!(file.path);
                      toast.success("恢复校验完成；当前编辑仍保留，可重新读取");
                    })
                  }
                >
                  恢复未完成写入
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const count = await adapter.cleanupArticleHistory!(
                        file.path,
                      );
                      toast.success(`已清理 ${count} 份已提交日志`);
                    })
                  }
                >
                  清理已提交日志
                </button>
              </div>
            ))}
          <h4>整包移动与删除</h4>
          <p>
            操作失败保留完整恢复副本。清理已完成操作会永久删除这份副本，之后无法用它恢复被删除的文章。
          </p>
          {operations.length === 0 && <p>没有整包操作记录。</p>}
          {operations.map((op) => (
            <div key={op.id} className="directory-maintenance-item">
              <strong>{op.source}</strong>
              <small>
                {op.target ? `移动到 ${op.target}` : "删除"} ·{" "}
                {op.complete ? "已完成" : "待处理"}
              </small>
              {op.complete ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => adapter.cleanupArticleOperation!(op.id))
                  }
                >
                  永久清理恢复副本
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => adapter.recoverArticleOperation!(op.id))
                  }
                >
                  继续整包操作
                </button>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
