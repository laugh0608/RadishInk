import { createPortal } from "react-dom";
import { normalizeLegacyArticle } from "../../storage/articles/articleContract";
import { useRef, useState } from "react";
import { Modal } from "../common/Modal";
import {
  validateBackup,
  type HistoryBackup,
} from "../../storage/articles/browserArticleDatabase";
import {
  prepareHistoryRestore,
  mergeHistoryBackup,
} from "../../store/historyDb";
import { useHistoryStore } from "../../store/historyStore";
import { useHistoryStorageState } from "../../store/historyStorageState";
import { useEditorStore } from "../../store/editorStore";
import { useThemeStore } from "../../store/themeStore";
import "./HistoryStorageNotice.css";

type Plan = Awaited<ReturnType<typeof prepareHistoryRestore>>;
export function HistoryBackupRestore() {
  const input = useRef<HTMLInputElement>(null);
  const status = useHistoryStorageState((s) => s.status);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preview = async (file: File) => {
    setOpen(true);
    setPlan(null);
    setConfirmed(false);
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("备份超过 20 MiB，请先分批整理后恢复");
      const backup = JSON.parse(await file.text()) as HistoryBackup;
      validateBackup(backup, "wemd-history");
      if (backup.records.length > 1000)
        throw new Error("单次恢复最多 1000 篇，请先分批整理");
      // 预览前保存当前正文；合并本身不会切换或覆盖活动文章。
      const history = useHistoryStore.getState();
      if (history.activeId) {
        const theme = useThemeStore.getState();
        await history.persistActiveSnapshot({
          markdown: useEditorStore.getState().markdown,
          theme: theme.themeId,
          themeName: theme.themeName,
          customCSS: theme.customCSS,
        });
      }
      setPlan(await prepareHistoryRestore(backup));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!plan || !confirmed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await mergeHistoryBackup(plan);
      // loadHistory 幂等，显式追加恢复条目而不重载活动编辑。
      const existing = useHistoryStore.getState().history;
      const added = plan.backup.records
        .filter((row) => !plan.expected.has(row.key))
        .map((row) => normalizeLegacyArticle(row.value));
      useHistoryStore.setState({
        history: [...existing, ...added].sort(
          (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt),
        ),
      });
      setMessage(
        `已恢复 ${result.imported} 篇，保留现有同 ID 文章 ${result.skipped} 篇。当前编辑未切换。`,
      );
      setPlan(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setPlan(null);
    } finally {
      setBusy(false);
      setConfirmed(false);
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="选择旧文章 JSON 备份"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void preview(file);
        }}
      />
      <button
        className="history-backup-button"
        disabled={status !== "ready" || busy}
        onClick={() => input.current?.click()}
      >
        恢复旧 JSON 备份
      </button>
      {createPortal(
        <Modal
          closeDisabled={busy}
          open={open}
          title="恢复旧文章备份"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div className="history-storage-actions">
            <p>
              只接受本应用升级前导出的 v2 文章备份。新增缺失的文章 ID；已有同 ID
              文章始终保留，不覆盖或自动合并正文。备份不含升级后的资源、设置及后续更改。
            </p>
            <p>
              旧备份可恢复超过 30
              篇；超过上限后仍可编辑，但需主动整理后才能新建。单次最多 20 MiB /
              1000 篇。
            </p>
            {message && <p role="status">{message}</p>}
            {plan && (
              <>
                <p>
                  备份 {plan.backup.records.length} 篇，将新增{" "}
                  {plan.backup.records.length - plan.conflicts.length} 篇，跳过{" "}
                  {plan.conflicts.length} 篇同 ID 文章。
                </p>
                {plan.conflicts.length > 0 && (
                  <details>
                    <summary>查看保留的现有文章</summary>
                    <ul>
                      {plan.conflicts.map((row) => (
                        <li key={row.id}>{row.title || row.id}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  确认按上述范围恢复，并继续保留原始备份文件
                </label>
                <button
                  disabled={busy || !confirmed}
                  onClick={() => void restore()}
                >
                  确认恢复缺失文章
                </button>
              </>
            )}
            <button disabled={busy} onClick={() => input.current?.click()}>
              重新选择备份
            </button>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
