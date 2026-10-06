import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { useStorageContext } from "../storage/StorageContext";
import { useEditorStore } from "../store/editorStore";
import { useFileStore } from "../store/fileStore";
import { useHistoryStore } from "../store/historyStore";
import { useThemeStore } from "../store/themeStore";
import {
  applyMarkdownFileMeta,
  stripMarkdownExtension,
} from "../utils/markdownFileMeta";
import { appendMarkdownFileNameCounter } from "../utils/fileName";
import {
  downloadMarkdownFile,
  readMarkdownFile,
} from "../utils/markdownFileTransfer";
import { useFileSystem } from "./useFileSystem";
import { captureWorkspace } from "./captureWorkspace";
import {
  convertAdapterFilesToTreeItems,
  LAST_FILE_KEY,
} from "./useFileSystemHelpers";

function currentDocument(fileMode: boolean) {
  const { markdown } = useEditorStore.getState();
  const { themeId: theme, themeName, customCSS } = useThemeStore.getState();
  const file = useFileStore.getState();
  const history = useHistoryStore.getState();
  const entry = history.history.find((item) => item.id === history.activeId);
  const title = fileMode
    ? file.currentFile?.title ||
      stripMarkdownExtension(file.currentFile?.name || "未命名文章")
    : entry?.title || "未命名文章";
  const base = fileMode ? file.lastSavedContent : entry?.markdown || "";
  return {
    id: fileMode ? file.currentFile?.path : history.activeId,
    markdown,
    theme,
    themeName,
    customCSS,
    title,
    content: applyMarkdownFileMeta(base, {
      body: markdown,
      theme,
      themeName,
      title,
    }),
  };
}

export function useMarkdownFileTransfer() {
  const { adapter, type, ready } = useStorageContext();
  const { persistActiveFile } = useFileSystem();
  const [importing, setImporting] = useState(false);
  const busyRef = useRef(false);
  const contextRef = useRef({ adapter, type, ready });
  contextRef.current = { adapter, type, ready };
  const targetRef = useRef<ReturnType<typeof captureTarget> | null>(null);

  function captureTarget() {
    const workspaceCurrent = captureWorkspace(adapter);
    const id = currentDocument(type === "filesystem").id;
    return {
      isCurrent: () =>
        workspaceCurrent() &&
        contextRef.current.adapter === adapter &&
        contextRef.current.type === type &&
        contextRef.current.ready &&
        currentDocument(type === "filesystem").id === id,
    };
  }

  // 在打开选择器时绑定目标，选择期间切换工作区或文章也会取消。
  function beginImport() {
    targetRef.current = captureTarget();
  }

  async function importFile(file?: File) {
    if (!file || busyRef.current) {
      targetRef.current = null;
      return;
    }
    const target = targetRef.current || captureTarget();
    targetRef.current = null;
    busyRef.current = true;
    setImporting(true);
    let written = false;
    const assertCurrent = () => {
      if (!target.isCurrent())
        throw new Error(
          written
            ? "文件已写入原工作区；工作区或文章已切换，未打开导入文章"
            : "工作区或文章已切换，请重新选择文件导入",
        );
    };
    try {
      if (!ready || !adapter) throw new Error("存储尚未就绪");
      const imported = await readMarkdownFile(file);
      assertCurrent();
      const themeAvailable = useThemeStore
        .getState()
        .getAllThemes()
        .some((theme) => theme.id === imported.parsed.theme);
      const displayTheme = themeAvailable ? imported.parsed.theme : "default";
      const fileMode = type === "filesystem";
      if (!fileMode && useHistoryStore.getState().history.length >= 30) {
        throw new Error("浏览器最多保留 30 篇文章，请先导出并清理不需要的文章");
      }
      const before = currentDocument(fileMode);
      if (fileMode) {
        if (!before.id && before.markdown)
          throw new Error("当前内容尚未关联文件，请先导出保存后再导入");
        const saved = await persistActiveFile(false, true);
        assertCurrent();
        if (!saved) return;
      } else if (before.id) {
        const { markdown, title, theme, themeName, customCSS } = before;
        const saved = await useHistoryStore.getState().persistActiveSnapshot({
          markdown,
          title,
          theme,
          themeName,
          customCSS,
        });
        if (!saved) throw new Error("无法保存当前文章，请先导出内容后重试");
      } else if (before.markdown) {
        throw new Error("当前草稿尚未保存，请稍后重试或先导出内容");
      }
      assertCurrent();
      const savedCurrent = currentDocument(fileMode);
      // 历史保存期间继续输入时保留编辑器，避免用较早的保存结果切走。
      if (!fileMode && savedCurrent.content !== before.content)
        throw new Error("保存期间内容发生变化，请稍后再导入");

      const content = applyMarkdownFileMeta(imported.source, {
        body: imported.parsed.body,
        title: imported.title,
        theme: imported.parsed.theme,
        themeName: imported.parsed.themeName,
      });
      let activate: () => void;
      if (fileMode) {
        let name = imported.fileName;
        let counter = 1;
        while (await adapter.exists(name)) {
          assertCurrent();
          name = appendMarkdownFileNameCounter(imported.fileName, counter++);
        }
        assertCurrent();
        await adapter.writeFile(name, content);
        written = true;
        assertCurrent();
        const files = await adapter.listFiles();
        assertCurrent();
        useFileStore.getState().setFiles(convertAdapterFilesToTreeItems(files));
        activate = () => {
          useFileStore.setState({
            currentFile: {
              name,
              path: name,
              title: imported.title,
              themeName: imported.parsed.themeName,
              createdAt: new Date(),
              updatedAt: new Date(),
              size: new Blob([content]).size,
            },
            lastSavedContent: content,
            lastSavedAt: new Date(),
            isDirty: false,
          });
          try {
            localStorage.setItem(LAST_FILE_KEY, name);
          } catch {
            /* 恢复路径不可写不影响文章持久化 */
          }
        };
      } else {
        const history = useHistoryStore.getState();
        let title = imported.title;
        let counter = 1;
        while (history.history.some((entry) => entry.title === title))
          title = `${imported.title} (${counter++})`;
        const entry = await history.saveSnapshot(
          {
            markdown: applyMarkdownFileMeta(content, { title }),
            title,
            theme: displayTheme,
            themeName: themeAvailable ? imported.parsed.themeName : "默认主题",
            customCSS: "",
          },
          { force: true, activate: false },
        );
        if (!entry) throw new Error("未能创建导入文章");
        written = true;
        assertCurrent();
        activate = () => useHistoryStore.getState().setActiveId(entry.id);
      }
      const latest = currentDocument(fileMode);
      if (
        latest.content !== savedCurrent.content ||
        latest.customCSS !== savedCurrent.customCSS
      ) {
        toast(
          "已导入新文章；检测到继续编辑，保留当前内容，请从列表打开导入文章",
          { duration: 6000 },
        );
        return;
      }
      activate();
      useEditorStore.getState().setMarkdown(imported.parsed.body);
      useThemeStore.getState().selectTheme(displayTheme);
      if (!fileMode) useThemeStore.getState().setCustomCSS("");
      useHistoryStore.getState().setFilter("");
      toast.success("已导入为新文章");
      if (!themeAvailable)
        toast(
          "文件指定的主题未安装，已使用默认主题；Markdown 文件不包含主题样式",
          { duration: 6000 },
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${written ? "已写入，但未打开" : "导入失败"}：${message}`, {
        duration: 6000,
      });
    } finally {
      busyRef.current = false;
      setImporting(false);
    }
  }

  function exportFile() {
    try {
      const snapshot = currentDocument(type === "filesystem");
      downloadMarkdownFile(snapshot.title, snapshot.content);
      toast.success("已发起 Markdown 下载，请在浏览器中确认保存");
    } catch (error) {
      toast.error(
        `导出失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { importing, ready, beginImport, importFile, exportFile };
}
