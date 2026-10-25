import { useEffect, useMemo, useState } from "react";
import { useFileStore } from "../../store/fileStore";
import { useEditorStore } from "../../store/editorStore";
import { useHistoryStore } from "../../store/historyStore";
import { useHistoryStorageState } from "../../store/historyStorageState";
import { useThemeStore } from "../../store/themeStore";
import { useStorageContext } from "../../storage/StorageContext";
import { parseMarkdownFileContent } from "../../utils/markdownFileMeta";
import { platform } from "../../lib/platformAdapter";

/**
 * 格式化相对时间
 */
function formatRelativeTime(date: Date | null): string {
  if (!date) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 10) return "刚刚保存";
  if (diffSec < 60) return `${diffSec} 秒前保存`;
  if (diffMin < 60) return `${diffMin} 分钟前保存`;
  if (diffHour < 24) return `${diffHour} 小时前保存`;

  // 超过 24 小时显示具体时间
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 保存`;
}

export function SaveIndicator() {
  // 文件系统模式的状态
  const fileSavedAt = useFileStore((state) => state.lastSavedAt);
  const fileIsDirty = useFileStore((state) => state.isDirty);
  const fileIsSaving = useFileStore((state) => state.isSaving);

  const { type } = useStorageContext();
  const isFileMode = platform.isElectron || type === "filesystem";
  const markdown = useEditorStore((state) => state.markdown);
  const entry = useHistoryStore((state) =>
    state.history.find((row) => row.id === state.activeId),
  );
  const saveError = useHistoryStore((state) => state.saveError);
  const storageStatus = useHistoryStorageState((state) => state.status);
  const theme = useThemeStore((state) => state.themeId);
  const customCSS = useThemeStore((state) => state.customCSS);
  const themeName = useThemeStore((state) => state.themeName);
  const historySavedAt = useMemo(
    () => (entry ? new Date(entry.savedAt) : null),
    [entry],
  );
  const [displayText, setDisplayText] = useState("");
  const lastSavedAt = isFileMode ? fileSavedAt : historySavedAt;
  const isDirty = isFileMode
    ? fileIsDirty
    : !entry ||
      parseMarkdownFileContent(entry.markdown).body !== markdown ||
      entry.theme !== theme ||
      entry.customCSS !== customCSS ||
      entry.themeName !== themeName;
  const isSaving = isFileMode && fileIsSaving;

  // 定时刷新相对时间显示
  useEffect(() => {
    if (!lastSavedAt) {
      setDisplayText("");
      return;
    }

    const update = () => setDisplayText(formatRelativeTime(lastSavedAt));
    update();

    // 每 10 秒更新一次
    const timer = setInterval(update, 10000);
    return () => clearInterval(timer);
  }, [lastSavedAt]);

  if (!isFileMode && (saveError || storageStatus !== "ready")) {
    return (
      <span className="save-indicator unsaved">
        {saveError ? "未保存" : "存储未就绪"}
      </span>
    );
  }

  // 时间戳来自已提交的文章快照，不能用输入后的计时器模拟保存。
  if (isSaving) {
    return <span className="save-indicator saving">保存中...</span>;
  }

  if (isDirty) {
    return <span className="save-indicator unsaved">编辑中</span>;
  }

  if (displayText) {
    return <span className="save-indicator saved">{displayText}</span>;
  }

  // 初始状态：无编辑活动
  return <span className="save-indicator ready">就绪</span>;
}
