import { useCallback, useEffect, useRef } from "react";
import { useEditorStore, defaultMarkdown } from "../../store/editorStore";
import { useThemeStore } from "../../store/themeStore";
import { useHistoryStore } from "../../store/historyStore";
import { parseMarkdownFileContent } from "../../utils/markdownFileMeta";
import toast from "react-hot-toast";

const AUTO_SAVE_INTERVAL = 10 * 1000; // 10 秒 - Web 存储的较好平衡点
const UNTITLED_TITLE = "未命名文章";

function deriveTitle(markdown: string) {
  const trimmed = markdown.trim();
  if (!trimmed) return UNTITLED_TITLE;
  const headingMatch = trimmed.match(/^(#+)\s*(.+)$/m);
  if (headingMatch) {
    return headingMatch[2].trim().slice(0, 50) || UNTITLED_TITLE;
  }
  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim());
  return firstLine ? firstLine.trim().slice(0, 50) : UNTITLED_TITLE;
}

export function HistoryManager() {
  const markdown = useEditorStore((state) => state.markdown);
  const setMarkdown = useEditorStore((state) => state.setMarkdown);
  const setFilePath = useEditorStore((state) => state.setFilePath);
  const setWorkspaceDir = useEditorStore((state) => state.setWorkspaceDir);

  // 主题相关状态从 themeStore 获取
  const theme = useThemeStore((state) => state.themeId);
  const customCSS = useThemeStore((state) => state.customCSS);
  const themeName = useThemeStore((state) => state.themeName);
  const selectTheme = useThemeStore((state) => state.selectTheme);
  const setCustomCSS = useThemeStore((state) => state.setCustomCSS);

  const persistActiveSnapshot = useHistoryStore(
    (state) => state.persistActiveSnapshot,
  );
  const saveSnapshot = useHistoryStore((state) => state.saveSnapshot);
  const loadHistory = useHistoryStore((state) => state.loadHistory);
  const history = useHistoryStore((state) => state.history);
  const activeId = useHistoryStore((state) => state.activeId);
  const setActiveId = useHistoryStore((state) => state.setActiveId);
  const loading = useHistoryStore((state) => state.loading);
  const error = useHistoryStore((state) => state.error);

  const latestRef = useRef({ markdown, theme, customCSS, themeName });
  const prevMarkdownRef = useRef(markdown);
  const isInitialMountRef = useRef(true);
  const isRestoringRef = useRef(false);
  const hasUserEditedRef = useRef(false);
  const hasAppliedInitialHistoryRef = useRef(false);
  const restoredIdRef = useRef<string | null>(null);
  const creatingInitialSnapshotRef = useRef(false);
  const hasLoadedHistoryRef = useRef(false);
  const initialSnapshotAttemptedRef = useRef(false);
  const createdInitialSnapshotRef = useRef(false);
  const restoringContentRef = useRef<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // 重返浏览器模式时列表可能已在内存中，不依赖 loading 曾经为 true。
  useEffect(() => {
    if (!loading && !error) hasLoadedHistoryRef.current = true;
  }, [loading, error]);

  useEffect(() => {
    latestRef.current = { markdown, theme, customCSS, themeName };

    const markdownChanged = markdown !== prevMarkdownRef.current;
    prevMarkdownRef.current = markdown;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    // 检查当前变化是否与正在恢复的内容匹配
    if (
      restoringContentRef.current !== null &&
      markdown === restoringContentRef.current
    ) {
      restoringContentRef.current = null; // Reset
      return; // Skip marking as edited
    }

    // 只有在以下条件满足时才标记为已编辑：
    // 1. Markdown 实际发生了变化
    // 2. 当前不是在恢复中（保留旧检查以确保安全）
    // 3. 当前不是在加载中
    // 4. 历史记录已至少加载完成一次
    if (
      markdownChanged &&
      !isRestoringRef.current &&
      !loading &&
      hasLoadedHistoryRef.current
    ) {
      hasUserEditedRef.current = true;
    }
  }, [markdown, theme, customCSS, themeName, loading]);

  // 独立于编辑追踪：列表可能先于懒加载的管理器完成初始化。
  useEffect(() => {
    if (creatingInitialSnapshotRef.current) return;

    const {
      activeId: currentActiveId,
      history: currentHistory,
      loading: storeLoading,
    } = useHistoryStore.getState();
    if (storeLoading || useHistoryStore.getState().error) return;

    if (currentHistory.length) initialSnapshotAttemptedRef.current = true;
    if (
      !initialSnapshotAttemptedRef.current &&
      !currentActiveId &&
      currentHistory.length === 0 &&
      markdown.trim()
    ) {
      initialSnapshotAttemptedRef.current = true;
      createdInitialSnapshotRef.current = true;
      creatingInitialSnapshotRef.current = true;
      void saveSnapshot(
        {
          markdown,
          theme,
          customCSS,
          title: deriveTitle(markdown),
          themeName,
        },
        { force: true },
      )
        .catch(() => toast.error("保存失败，当前内容仍保留在编辑器中"))
        .finally(() => {
          creatingInitialSnapshotRef.current = false;
        });
    }
  }, [
    markdown,
    theme,
    customCSS,
    themeName,
    saveSnapshot,
    loading,
    history.length,
    error,
  ]);

  const persistLatestSnapshot = useCallback(async () => {
    const snapshot = latestRef.current;

    // 如果用户未编辑或当前正在恢复历史记录，则阻止自动保存
    if (!hasUserEditedRef.current || isRestoringRef.current) {
      return;
    }

    const {
      activeId: currentActiveId,
      history: currentHistory,
      loading: storeLoading,
    } = useHistoryStore.getState();
    if (storeLoading || useHistoryStore.getState().error) return;

    if (!currentActiveId) {
      if (currentHistory.length === 0) {
        await saveSnapshot(
          {
            markdown: snapshot.markdown,
            theme: snapshot.theme,
            customCSS: snapshot.customCSS,
            title: deriveTitle(snapshot.markdown),
            themeName: snapshot.themeName,
          },
          { force: true },
        );
      }
      return;
    }

    await persistActiveSnapshot({
      markdown: snapshot.markdown,
      theme: snapshot.theme,
      customCSS: snapshot.customCSS,
      themeName: snapshot.themeName,
    });
  }, [persistActiveSnapshot, saveSnapshot]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void persistLatestSnapshot().catch(() =>
        toast.error("自动保存失败，请导出当前内容后重试"),
      );
    }, AUTO_SAVE_INTERVAL);
    return () => window.clearInterval(intervalId);
  }, [persistLatestSnapshot]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = useHistoryStore.getState();
      const entry = state.history.find((row) => row.id === state.activeId);
      const current = useEditorStore.getState().markdown;
      const themeState = useThemeStore.getState();
      if (
        hasUserEditedRef.current &&
        (!entry ||
          parseMarkdownFileContent(entry.markdown).body !== current ||
          entry.theme !== themeState.themeId ||
          entry.customCSS !== themeState.customCSS)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    // 历史记录为空时，显示示例文章
    if (useHistoryStore.getState().loading || error) return;
    if (!history.length) {
      hasAppliedInitialHistoryRef.current = false;
      // 只有在加载完成后才填充示例，避免加载过程中的闪烁
      if (hasLoadedHistoryRef.current) {
        hasUserEditedRef.current = false;
        const latest = latestRef.current;
        // 仅当当前内容不是示例文章时才填充，避免重复设置
        if (latest.markdown !== defaultMarkdown) {
          restoringContentRef.current = defaultMarkdown;
          setMarkdown(defaultMarkdown);
        }
      }
      return;
    }
    const candidateEntry =
      history.find((entry) => entry.id === activeId) ?? history[0];
    if (!candidateEntry) return;

    // 保存完成或后台导入只更新列表，不能用迟到的快照覆盖正在输入的正文。
    if (
      hasAppliedInitialHistoryRef.current &&
      restoredIdRef.current === candidateEntry.id
    )
      return;
    restoredIdRef.current = candidateEntry.id;
    // 初始文章写入期间编辑器已可输入，完成保存只绑定身份，不回滚新输入。
    if (
      createdInitialSnapshotRef.current &&
      !hasAppliedInitialHistoryRef.current &&
      hasUserEditedRef.current
    ) {
      if (candidateEntry.id !== activeId) setActiveId(candidateEntry.id);
      hasAppliedInitialHistoryRef.current = true;
      return;
    }
    const body = parseMarkdownFileContent(candidateEntry.markdown).body;

    const latest = latestRef.current;
    const matchesLatest =
      latest.markdown === body &&
      latest.theme === candidateEntry.theme &&
      latest.customCSS === candidateEntry.customCSS &&
      latest.themeName === candidateEntry.themeName;

    // 首次加载时，始终应用历史记录，确保刷新后恢复上次编辑的内容

    if (matchesLatest) {
      if (candidateEntry.id !== activeId) {
        setActiveId(candidateEntry.id);
      }
      hasAppliedInitialHistoryRef.current = true;
      return;
    }

    if (candidateEntry.id !== activeId) {
      setActiveId(candidateEntry.id);
    }

    isRestoringRef.current = true;
    restoringContentRef.current = body;
    setMarkdown(body);
    selectTheme(candidateEntry.theme); // 使用 selectTheme 替代 setTheme + setThemeName
    setCustomCSS(candidateEntry.customCSS);
    setFilePath(candidateEntry.filePath);
    if (candidateEntry.filePath) {
      const last = Math.max(
        candidateEntry.filePath.lastIndexOf("/"),
        candidateEntry.filePath.lastIndexOf("\\"),
      );
      if (last >= 0) {
        const dir = candidateEntry.filePath.slice(0, last);
        if (dir) {
          setWorkspaceDir(dir);
        }
      }
    }
    latestRef.current = {
      markdown: body,
      theme: candidateEntry.theme,
      customCSS: candidateEntry.customCSS,
      themeName: candidateEntry.themeName,
    };
    hasUserEditedRef.current = false;
    isRestoringRef.current = false;
    hasAppliedInitialHistoryRef.current = true;
  }, [
    history,
    loading,
    error,
    activeId,
    setActiveId,
    setMarkdown,
    selectTheme,
    setCustomCSS,
    setFilePath,
    setWorkspaceDir,
  ]);

  return null;
}
