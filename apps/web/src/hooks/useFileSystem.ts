import { useCallback, useRef } from "react";
import { useFileStore } from "../store/fileStore";
import { useEditorStore } from "../store/editorStore";
import { useThemeStore } from "../store/themeStore";
import { useStorageContext } from "../storage/StorageContext";
import type { FileItem } from "../store/fileTypes";
import toast from "react-hot-toast";
import {
  applyMarkdownFileMeta,
  buildMarkdownFileContent,
  parseMarkdownFileContent,
  stripMarkdownExtension,
} from "../utils/markdownFileMeta";
import { resolveNewArticleThemeSnapshot } from "../utils/newArticleTheme";
import {
  convertAdapterFilesToTreeItems,
  convertToTreeItems,
  flattenFiles,
  getElectron,
  joinPath,
  LAST_FILE_KEY,
  splitPath,
  WORKSPACE_KEY,
} from "./useFileSystemHelpers";
import { useFileSystemFolderActions } from "./useFileSystemFolderActions";
import { useFileSystemEffects } from "./useFileSystemEffects";
import { useActiveFilePersistence } from "./useActiveFilePersistence";
import { captureWorkspace } from "./captureWorkspace";
import {
  appendMarkdownFileNameCounter,
  normalizeMarkdownFileName,
} from "../utils/fileName";

interface UseFileSystemOptions {
  enableEffects?: boolean;
}

export function useFileSystem(options: UseFileSystemOptions = {}) {
  const { enableEffects = false } = options;
  const {
    adapter,
    ready: storageReady,
    type: storageType,
  } = useStorageContext();
  const electron = getElectron();
  const {
    workspacePath,
    workspaceRevision,
    files,
    currentFile,
    isLoading,
    isSaving,
    lastSavedContent,
    isDirty,
    isRestoring,
    setWorkspacePath,
    bumpWorkspaceRevision,
    setFiles,
    setCurrentFile,
    setLoading,
    setSaving,
    setLastSavedContent,
    setLastSavedAt,
    setIsDirty,
    setIsRestoring,
  } = useFileStore();
  const { setMarkdown, markdown } = useEditorStore();
  const { themeId: theme, themeName } = useThemeStore();
  const isCreating = useRef<boolean>(false);
  const fileRefreshGenerationRef = useRef(0);

  const invalidateFileRefreshes = useCallback(() => {
    fileRefreshGenerationRef.current += 1;
  }, []);

  const resetActiveFile = useCallback(() => {
    setCurrentFile(null);
    setMarkdown("");
    setIsDirty(false);
    setLastSavedContent("");
    setLastSavedAt(null);
    try {
      window.localStorage?.removeItem?.(LAST_FILE_KEY);
    } catch {
      /* 浏览器禁用存储时不影响工作区切换 */
    }
  }, [
    setCurrentFile,
    setIsDirty,
    setLastSavedAt,
    setLastSavedContent,
    setMarkdown,
  ]);

  const resolveAvailableFilePath = useCallback(
    async (folderPath: string | undefined, fileName: string) => {
      if (!adapter || !storageReady) {
        return { fileName, filePath: joinPath(folderPath, fileName) };
      }

      let candidateName = fileName;
      let candidatePath = joinPath(folderPath, candidateName);
      let counter = 1;

      while (await adapter.exists(candidatePath)) {
        candidateName = appendMarkdownFileNameCounter(fileName, counter);
        candidatePath = joinPath(folderPath, candidateName);
        counter += 1;
      }

      return { fileName: candidateName, filePath: candidatePath };
    },
    [adapter, storageReady],
  );

  const refreshFiles = useCallback(
    async (dir?: string) => {
      const refreshGeneration = fileRefreshGenerationRef.current;
      if (electron) {
        const target = dir || workspacePath;
        if (!target) return;

        const res = await electron.fs.listFiles(target);
        if (
          refreshGeneration === fileRefreshGenerationRef.current &&
          res.success &&
          res.files
        ) {
          setFiles(convertToTreeItems(res.files));
        }
        return;
      }

      if (adapter && storageReady) {
        try {
          const rawFiles = await adapter.listFiles();
          if (refreshGeneration === fileRefreshGenerationRef.current) {
            setFiles(convertAdapterFilesToTreeItems(rawFiles));
          }
        } catch (error) {
          if (refreshGeneration !== fileRefreshGenerationRef.current) return;
          console.error("加载文件列表失败:", error);
          toast.error("无法加载文件列表");
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspacePath, electron, adapter, storageReady],
  );

  const loadWorkspace = useCallback(
    async (path: string) => {
      if (electron) {
        setLoading(true);
        invalidateFileRefreshes();
        try {
          const res = await electron.fs.setWorkspace(path);
          if (res.success) {
            resetActiveFile();
            setFiles([]);
            setWorkspacePath(path);
            bumpWorkspaceRevision();
            localStorage.setItem(WORKSPACE_KEY, path);
            await refreshFiles(path);
          } else {
            setWorkspacePath(null);
            localStorage.removeItem(WORKSPACE_KEY);
          }
        } catch (error) {
          console.error(error);
        } finally {
          setLoading(false);
        }
        return;
      }

      invalidateFileRefreshes();
      setWorkspacePath(path);
      bumpWorkspaceRevision();
      await refreshFiles();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [electron, invalidateFileRefreshes, resetActiveFile],
  );

  const persistActiveFile = useActiveFilePersistence({
    adapter,
    electron,
    storageReady,
    setIsDirty,
    setLastSavedAt,
    setLastSavedContent,
    setSaving,
  });

  const openFile = useCallback(
    async (file: FileItem) => {
      setIsRestoring(true);

      const workspaceCurrent = captureWorkspace(adapter);
      if (!(await persistActiveFile(false, true)) || !workspaceCurrent()) {
        setIsRestoring(false);
        return;
      }
      const before = {
        path: useFileStore.getState().currentFile?.path,
        markdown: useEditorStore.getState().markdown,
        theme: useThemeStore.getState().themeId,
      };

      let content = "";
      let success = false;

      if (electron) {
        const res = await electron.fs.readFile(file.path);
        if (res.success && typeof res.content === "string") {
          content = res.content;
          success = true;
        }
      } else if (adapter && storageReady) {
        try {
          content = await adapter.readFile(file.path);
          success = true;
        } catch (error) {
          console.error("读取文件错误:", error);
        }
      }

      if (
        !workspaceCurrent() ||
        before.path !== useFileStore.getState().currentFile?.path ||
        before.markdown !== useEditorStore.getState().markdown ||
        before.theme !== useThemeStore.getState().themeId
      ) {
        setIsRestoring(false);
        toast.error("读取期间文章或工作区发生变化，请重新打开");
        return;
      }

      if (success) {
        const parsed = parseMarkdownFileContent(content);
        const resolvedTitle =
          parsed.title?.trim() ||
          file.title?.trim() ||
          stripMarkdownExtension(file.name);

        setCurrentFile({ ...file, title: resolvedTitle });
        setMarkdown(parsed.body);
        useThemeStore.getState().selectTheme(parsed.theme);
        setLastSavedContent(content);
        setIsDirty(false);
      } else {
        toast.error("无法读取文件");
      }

      setTimeout(() => {
        setIsRestoring(false);
      }, 100);

      localStorage.setItem(LAST_FILE_KEY, file.path);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setMarkdown, electron, adapter, storageReady, persistActiveFile],
  );

  const createFile = useCallback(
    async (folderPath?: string) => {
      if (isCreating.current) return;
      isCreating.current = true;

      const initialTitle = "新文章";
      const themeState = useThemeStore.getState();
      const targetTheme = resolveNewArticleThemeSnapshot(
        themeState,
        themeState.getAllThemes(),
      );
      const initialContent = buildMarkdownFileContent({
        body: "# 新文章\n\n",
        theme: targetTheme.themeId,
        themeName: targetTheme.themeName,
        title: initialTitle,
      });

      try {
        const filename = normalizeMarkdownFileName(initialTitle);
        const targetPath = joinPath(folderPath, filename);

        if (electron) {
          if (!workspacePath) return;
          const res = await electron.fs.createFile({
            filename: targetPath,
            content: initialContent,
          });
          if (res.success && res.filePath) {
            await refreshFiles();
            const newFile = {
              name: res.filename!,
              path: res.filePath!,
              createdAt: new Date(),
              updatedAt: new Date(),
              size: 0,
              title: initialTitle,
              themeName: targetTheme.themeName,
            };
            await openFile(newFile);
            toast.success("已创建新文章");
          }
          return;
        }

        if (adapter && storageReady) {
          const available = await resolveAvailableFilePath(
            folderPath,
            filename,
          );
          await adapter.writeFile(available.filePath, initialContent);
          await refreshFiles();
          const newFile = {
            name: available.fileName,
            path: available.filePath,
            createdAt: new Date(),
            updatedAt: new Date(),
            size: initialContent.length,
            title: initialTitle,
            themeName: targetTheme.themeName,
          };
          await openFile(newFile);
          toast.success("已创建新文章");
        }
      } catch {
        toast.error("创建失败");
      } finally {
        isCreating.current = false;
      }
    },
    [
      workspacePath,
      refreshFiles,
      openFile,
      electron,
      adapter,
      storageReady,
      resolveAvailableFilePath,
    ],
  );

  const saveFile = useCallback(
    async (showToast = false) => {
      await persistActiveFile(showToast);
    },
    [persistActiveFile],
  );

  const selectWorkspace = useCallback(async () => {
    if (electron) {
      setLoading(true);
      try {
        if (!(await persistActiveFile(false, true))) return;

        const res = await electron.fs.selectWorkspace();
        if (res.success && res.path) {
          await loadWorkspace(res.path);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (storageType === "filesystem" && adapter?.selectWorkspace) {
      const selection = adapter.selectWorkspace({
        beforeCommit: async () => {
          const saved = await persistActiveFile(false, true);
          if (saved) invalidateFileRefreshes();
          return saved;
        },
      });
      setLoading(true);
      try {
        const result = await selection;
        if (result.success) {
          resetActiveFile();
          setFiles([]);
          setWorkspacePath(result.workspaceName || "本地文件夹");
          bumpWorkspaceRevision();
          await refreshFiles();
        } else if (!result.canceled) {
          toast.error(result.error || "无法切换工作区");
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    toast('请在右上角"存储模式"中切换文件夹', { icon: "ℹ️" });
  }, [
    adapter,
    bumpWorkspaceRevision,
    electron,
    invalidateFileRefreshes,
    loadWorkspace,
    persistActiveFile,
    refreshFiles,
    resetActiveFile,
    setFiles,
    setLoading,
    setWorkspacePath,
    storageType,
  ]);

  const updateFileTitle = useCallback(
    async (file: FileItem, newName: string) => {
      const nextTitle = newName.trim();
      if (!nextTitle) {
        toast.error("标题不能为空");
        return;
      }

      let content = "";
      if (electron) {
        const readRes = await electron.fs.readFile(file.path);
        if (!readRes.success || typeof readRes.content !== "string") {
          toast.error(readRes.error || "读取文件失败");
          return;
        }
        content = readRes.content;
      } else if (adapter && storageReady) {
        try {
          content = await adapter.readFile(file.path);
        } catch {
          toast.error("读取文件失败");
          return;
        }
      } else {
        toast.error("当前模式不支持此操作");
        return;
      }

      const parsed = parseMarkdownFileContent(content);
      const fullContent = applyMarkdownFileMeta(content, {
        body: parsed.body,
        theme: parsed.theme,
        themeName: parsed.themeName,
        title: nextTitle,
      });
      const targetFileName = normalizeMarkdownFileName(nextTitle);
      const { dir } = splitPath(file.path);
      const targetPath = joinPath(dir, targetFileName);

      let success = false;
      let errorMsg = "";
      let nextPath = file.path;
      let nextName = file.name;
      if (electron) {
        if (targetPath !== file.path) {
          const renameRes = await electron.fs.renameFile({
            oldPath: file.path,
            newName: targetFileName,
          });
          success = renameRes.success;
          errorMsg = renameRes.error || "";
          if (renameRes.success) {
            nextPath = renameRes.filePath || targetPath;
            nextName = targetFileName;
          }
        }
        if (success || targetPath === file.path) {
          const saveRes = await electron.fs.saveFile({
            filePath: nextPath,
            content: fullContent,
          });
          success = saveRes.success;
          errorMsg = saveRes.error || "";
        }
      } else if (adapter && storageReady) {
        try {
          if (targetPath !== file.path) {
            if (await adapter.exists(targetPath)) {
              throw new Error("文件名已存在");
            }
            await adapter.renameFile(file.path, targetPath);
            nextPath = targetPath;
            nextName = targetFileName;
          }
          await adapter.writeFile(nextPath, fullContent);
          success = true;
        } catch (error: unknown) {
          errorMsg = error instanceof Error ? error.message : String(error);
        }
      }

      if (!success) {
        toast.error(errorMsg || "重命名失败");
        return;
      }

      if (currentFile && currentFile.path === file.path) {
        setCurrentFile({
          ...currentFile,
          name: nextName,
          path: nextPath,
          title: nextTitle,
        });
        localStorage.setItem(LAST_FILE_KEY, nextPath);
        const currentState = useFileStore.getState();
        if (!currentState.isDirty) {
          setLastSavedContent(fullContent);
        }
      }

      toast.success("已重命名");
      await refreshFiles();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshFiles, currentFile, electron, adapter, storageReady],
  );

  const deleteFile = useCallback(
    async (file: FileItem) => {
      let success = false;

      if (electron) {
        const res = await electron.fs.deleteFile(file.path);
        success = res.success;
      } else if (adapter && storageReady) {
        try {
          await adapter.deleteFile(file.path);
          success = true;
        } catch (error) {
          console.error(error);
        }
      }

      if (success) {
        toast.success("已删除");
        await refreshFiles();
        if (currentFile && currentFile.path === file.path) {
          setCurrentFile(null);
          setMarkdown("");
          setIsDirty(false);
          setLastSavedContent("");
        }
      } else {
        toast.error("删除失败");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshFiles, currentFile, setMarkdown, electron, adapter, storageReady],
  );

  const folderActions = useFileSystemFolderActions({
    electron,
    adapter,
    refreshFiles,
    currentFile,
    setCurrentFile,
    setMarkdown,
    setIsDirty,
    setLastSavedContent,
  });

  useFileSystemEffects({
    enabled: enableEffects,
    electron,
    adapter,
    storageReady,
    storageType,
    currentFile,
    markdown,
    theme,
    themeName,
    isRestoring,
    isDirty,
    lastSavedContent,
    isLoading,
    loadWorkspace,
    refreshFiles,
    openFile,
    createFile,
    saveFile,
    selectWorkspace,
    setCurrentFile,
    setMarkdown,
    setIsDirty,
    setLastSavedContent,
    setLoading,
    setWorkspacePath,
  });

  return {
    workspacePath,
    workspaceRevision,
    files,
    currentFile,
    isLoading,
    isSaving,
    selectWorkspace,
    refreshFiles,
    openFile,
    createFile,
    saveFile,
    persistActiveFile,
    updateFileTitle,
    renameFile: updateFileTitle,
    deleteFile,
    ...folderActions,
    flattenFiles,
  };
}
