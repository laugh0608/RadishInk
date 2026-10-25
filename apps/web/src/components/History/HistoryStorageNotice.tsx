import { useState } from "react";
import { Modal } from "../common/Modal";
import { useHistoryStore } from "../../store/historyStore";
import { useHistoryStorageState } from "../../store/historyStorageState";
import {
  prepareHistoryUpgrade,
  upgradeHistoryDatabase,
} from "../../store/historyDb";
import type { HistoryBackup } from "../../storage/articles/browserArticleDatabase";
import { useEditorStore } from "../../store/editorStore";
import { useThemeStore } from "../../store/themeStore";
import { applyMarkdownFileMeta } from "../../utils/markdownFileMeta";
import { downloadMarkdownFile } from "../../utils/markdownFileTransfer";
import "./HistoryStorageNotice.css";

export function HistoryStorageNotice() {
  const { status, message } = useHistoryStorageState();
  const readError = useHistoryStore((state) => state.error);
  const saveError = useHistoryStore((state) => state.saveError);
  const [dismissed, setDismissed] = useState(false);
  const [backup, setBackup] = useState<HistoryBackup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsUpgrade = status === "upgrade-required" || !!backup;
  const problem = message || readError || saveError;
  if (status === "checking" || (status === "ready" && !readError && !saveError))
    return null;

  const exportDraft = () => {
    const history = useHistoryStore.getState();
    const entry = history.history.find((row) => row.id === history.activeId);
    const theme = useThemeStore.getState();
    downloadMarkdownFile(
      entry?.title || "未保存正文",
      applyMarkdownFileMeta(entry?.markdown || "", {
        body: useEditorStore.getState().markdown,
        title: entry?.title || "未保存正文",
        theme: theme.themeId,
        themeName: theme.themeName,
      }),
    );
  };
  const downloadBackup = async () => {
    setBusy(true);
    setError("");
    setConfirmed(false);
    setBackup(null);
    try {
      const snapshot = await prepareHistoryUpgrade();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(snapshot, null, 2)], {
          type: "application/json",
        }),
      );
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `radishink-history-v2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setBackup(snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const upgrade = async () => {
    if (!backup || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await upgradeHistoryDatabase(backup);
      await useHistoryStore.getState().loadHistory();
      setBackup(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // 失败后必须重新导出，不能沿用可能已经过期的备份。
      setBackup(null);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="history-storage-notice" role="alert">
        <span>
          {needsUpgrade
            ? "浏览器文章需要备份后升级，当前暂停写入。"
            : `文章未保存：${problem}`}
        </span>
        <button onClick={() => setDismissed(false)}>查看处理方式</button>
        <button onClick={exportDraft}>下载当前正文</button>
      </div>
      <Modal
        open={!dismissed}
        onClose={() => {
          if (!busy) setDismissed(true);
        }}
        title={needsUpgrade ? "备份并升级浏览器文章" : "浏览器文章暂不可用"}
      >
        <div className="history-storage-actions">
          {needsUpgrade ? (
            <>
              <p>
                升级会保留全部文章、标题、主题和原始
                Markdown，并为文章增加资源存储。旧版本无法再打开升级后的数据库，请使用兼容版本。
              </p>
              <p>
                先下载升级前的 JSON
                备份并确认文件已保存。备份只包含浏览器历史文章，不包含站点设置、文件夹或外链图片。
              </p>
              <button disabled={busy} onClick={() => void downloadBackup()}>
                下载升级前备份
              </button>
              {backup && (
                <>
                  <p>本次备份包含 {backup.records.length} 篇文章。</p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    我已确认备份文件保存成功，知晓旧版本无法打开升级后的数据库
                  </label>
                </>
              )}
              <button
                disabled={!backup || !confirmed || busy}
                onClick={() => void upgrade()}
              >
                {busy ? "处理中…" : "确认升级"}
              </button>
            </>
          ) : (
            <p>
              {problem}
              。不会清空数据库或把读取失败当作空文章列表。关闭占用的旧标签页后可以重试；已有未保存编辑请先下载当前正文，再刷新页面。
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {!needsUpgrade && !!readError && (
            <button
              disabled={busy}
              onClick={() => void useHistoryStore.getState().loadHistory()}
            >
              重试读取
            </button>
          )}
          <button onClick={exportDraft}>下载当前正文</button>
          <button disabled={busy} onClick={() => setDismissed(true)}>
            稍后处理
          </button>
        </div>
      </Modal>
    </>
  );
}
