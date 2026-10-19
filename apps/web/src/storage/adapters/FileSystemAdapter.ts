import { DirectoryArticleWorkspace } from "../articles/directoryArticleWorkspace";
import {
  readText,
  writeFile as writeBytes,
  optionalFile,
} from "../articles/directoryArticleIO";
import { ArticleStorageError } from "../articles/articleContract";
import { checkedPath } from "../articles/directoryPackageOperations";
import {
  reportDirectoryIssue,
  useDirectoryStorageState,
} from "../../store/directoryStorageState";
import type {
  StorageAdapter,
  WorkspaceSelectionOptions,
  WorkspaceSelectionResult,
} from "../StorageAdapter";
import type {
  FileItem,
  StorageAdapterContext,
  StorageInitResult,
} from "../types";
import {
  copyDirectoryRecursive,
  deleteDirectoryRecursive,
  normalizePath,
  resolveDirectoryHandle,
  resolveFileHandle,
  resolveParentAndName,
  splitPath,
} from "./fileSystemAdapterHelpers";

export class FileSystemAdapter implements StorageAdapter {
  readonly type = "filesystem" as const;
  readonly name = "FileSystem Access";
  readonly supportsFolders = true;
  ready = false;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private handleKey = "fs-handle";
  private articles: DirectoryArticleWorkspace | null = null;
  private legacyRead = new Map<string, string>();
  private workspace() {
    const root = this.ensureHandle();
    if (this.articles?.root !== root) {
      this.articles = new DirectoryArticleWorkspace(root);
      this.legacyRead.clear();
    }
    return this.articles;
  }
  private async articleAction<T>(
    path: string,
    action: (workspace: DirectoryArticleWorkspace) => Promise<T>,
  ): Promise<T> {
    const workspace = this.workspace();
    try {
      const result = await action(workspace);
      const issue = useDirectoryStorageState.getState().issue;
      if (issue?.workspace === workspace.root && issue.path === path && path)
        useDirectoryStorageState.setState({ issue: null });
      return result;
    } catch (error) {
      reportDirectoryIssue(workspace.root, path, error);
      throw error;
    }
  }
  saveArticleConflictCopy(path: string, content: string) {
    return this.articleAction(path, (w) => w.saveConflictCopy(path, content));
  }
  forgetArticleRead(path: string) {
    this.workspace().forgetRead(path);
    this.legacyRead.delete(path);
  }
  createArticle(
    content: string,
    title: string,
    folderPath = "",
    assets: import("../articles/articleContract").ArticleAsset[] = [],
  ) {
    return this.articleAction(folderPath, (w) =>
      w.create(content, title, folderPath, undefined, assets),
    );
  }
  copyLegacyArticle(path: string) {
    return this.articleAction(path, (w) => w.copyLegacy(path));
  }
  recoverArticle(path: string) {
    return this.articleAction(path, (w) => w.recover(path));
  }
  cleanupArticleHistory(path: string) {
    return this.articleAction(path, (w) => w.cleanupHistory(path));
  }
  listArticleOperations() {
    return this.articleAction("", (w) => w.operations());
  }
  recoverArticleOperation(id: string) {
    return this.articleAction("", (w) => w.recoverOperation(id));
  }
  cleanupArticleOperation(id: string) {
    return this.articleAction("", (w) => w.cleanupOperation(id));
  }

  // 获取选择的目录名称
  get directoryName(): string | null {
    return this.directoryHandle?.name ?? null;
  }

  getWorkspaceIdentity(): unknown {
    return this.directoryHandle;
  }
  getArticleAssets(path: string) {
    return this.workspace().getAssets(path);
  }
  readArticleAssetsForExport(path: string) {
    return this.articleAction(path, (w) => w.readAssetsForExport(path));
  }
  appendArticleAssets(
    path: string,
    assets: import("../articles/articleContract").ArticleAsset[],
  ) {
    return this.articleAction(path, (w) => w.appendAssets(path, assets));
  }

  async init(context?: StorageAdapterContext): Promise<StorageInitResult> {
    if (!("showDirectoryPicker" in window)) {
      return { ready: false, message: "File System Access API not supported" };
    }

    if (context?.identifier) {
      this.handleKey = `fs-handle-${context.identifier}`;
    }

    if (context?.identifier && !this.directoryHandle) {
      this.directoryHandle = await this.restoreHandle();
    }

    if (!this.directoryHandle) {
      if (context?.restore)
        return {
          ready: false,
          permissionRequired: true,
          message: "未找到已保存的文件夹授权，请重新选择原文件夹",
        };
      this.directoryHandle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      await this.persistHandle(this.directoryHandle);
    }

    if (context?.restore) {
      const permission = await this.directoryHandle.queryPermission({
        mode: "readwrite",
      });
      this.ready = permission === "granted";
      return {
        ready: this.ready,
        permissionRequired: !this.ready,
        message: this.ready
          ? "已恢复本地文件夹"
          : "文件夹需要重新授权；当前内容不会被替换",
      };
    }
    return this.requestWorkspacePermission();
  }

  async requestWorkspacePermission(): Promise<StorageInitResult> {
    if (!this.directoryHandle)
      return {
        ready: false,
        permissionRequired: true,
        message: "请重新选择原文件夹",
      };
    const permission = await this.directoryHandle.requestPermission({
      mode: "readwrite",
    });
    this.ready = permission === "granted";
    return {
      ready: this.ready,
      permissionRequired: !this.ready,
      message: this.ready
        ? "文件夹授权已恢复，当前编辑保留"
        : "未获得文件夹权限；如已在浏览器中禁用文件修改，请先在地址栏网站权限中恢复允许，再点击重新授权",
    };
  }

  private async persistHandle(handle: FileSystemDirectoryHandle) {
    try {
      const db = await this.openHandleDb();
      const tx = db.transaction("handles", "readwrite");
      await tx.store.put(handle, this.handleKey);
      await tx.done;
    } catch {
      /* ignore */
    }
  }

  private async restoreHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await this.openHandleDb();
    const tx = db.transaction("handles", "readonly");
    const handle = await tx.store.get(this.handleKey);
    await tx.done;
    return handle ?? null;
  }

  private async openHandleDb() {
    const { openDB } = await import("idb");
    return openDB("wemd-fs-handles", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("handles")) {
          db.createObjectStore("handles");
        }
      },
    });
  }

  private ensureHandle() {
    if (!this.directoryHandle)
      throw new Error("Directory handle not initialized");
    return this.directoryHandle;
  }

  /**
   * 递归读取目录，返回树形结构
   */
  async listFiles(): Promise<FileItem[]> {
    return this.articleAction("", (w) => w.list());
  }

  async readFile(path: string): Promise<string> {
    // 沿用既有工作区主题配置键；它不是文章包内部的任意文件访问。
    if (path === ".wemd/themes.json")
      return readText(await (await this.resolveFileHandle(path)).getFile());
    return this.articleAction(path, async (w) => {
      const article = await w.read(path);
      if (article !== null) return article;
      checkedPath(path);
      await w.assertOrdinaryFolder(this.splitPath(path).dir);
      const file = await (await resolveFileHandle(w.root, path)).getFile();
      const content = await readText(file);
      this.legacyRead.set(path, content);
      return content;
    });
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (path === ".wemd/themes.json") {
      const folder = await this.ensureHandle().getDirectoryHandle(".wemd", {
        create: true,
      });
      await writeBytes(folder, "themes.json", content);
      return;
    }
    await this.articleAction(path, async (w) => {
      if (await w.write(path, content)) return;
      checkedPath(path);
      await w.assertOrdinaryFolder(this.splitPath(path).dir);
      const { parent, name } = await resolveParentAndName(w.root, path);
      const existing = await optionalFile(parent, name);
      if (
        /\.(md|markdown)$/i.test(name) &&
        existing &&
        (await readText(existing)) !== this.legacyRead.get(path)
      )
        throw new ArticleStorageError(
          "conflict",
          "文件已被外部修改或尚未读取，请先保留当前正文再重新打开",
        );
      await writeBytes(parent, name, content);
      this.legacyRead.set(path, content);
    });
  }

  async deleteFile(path: string): Promise<void> {
    await this.articleAction(path, async (w) => {
      if ((await w.operate(path, null)) !== null) return;
      checkedPath(path);
      await w.assertOrdinaryFolder(this.splitPath(path).dir);
      const { parent, name } = await resolveParentAndName(w.root, path);
      const existing = await optionalFile(parent, name);
      if (!existing || (await readText(existing)) !== this.legacyRead.get(path))
        throw new ArticleStorageError(
          "conflict",
          "请先打开并确认文件内容，再删除",
        );
      await parent.removeEntry(name);
      this.legacyRead.delete(path);
    });
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const normalizedOld = this.normalizePath(oldPath);
    const normalizedNew = this.normalizePath(newPath);
    if (
      normalizedOld.endsWith("/index.md") &&
      (await this.workspace().isPackage(normalizedOld))
    )
      throw new ArticleStorageError(
        "invalid",
        "文章包通过标题元数据改名，不能重命名 index.md",
      );

    if (normalizedOld === normalizedNew) return;

    const { dir: oldDir } = this.splitPath(normalizedOld);
    const { dir: newDir, name: nextName } = this.splitPath(normalizedNew);

    if (!nextName || nextName === "." || nextName === "..") {
      throw new Error("文件名不能为空");
    }
    if (oldDir !== newDir) {
      throw new Error("仅支持同目录重命名");
    }

    const targetPath = oldDir ? `${oldDir}/${nextName}` : nextName;
    const expected = this.legacyRead.get(normalizedOld);
    const content = await this.readFile(normalizedOld);
    if (expected !== undefined && content !== expected) {
      this.legacyRead.set(normalizedOld, expected);
      throw new ArticleStorageError(
        "conflict",
        "文件在改名前已被外部修改，未移动或覆盖",
      );
    }
    await this.writeFile(targetPath, content);
    await this.deleteFile(normalizedOld);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.resolveFileHandle(path);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "NotFoundError") return false;
      throw error;
    }
  }

  async teardown() {
    this.directoryHandle = null;
    this.articles = null;
    this.legacyRead.clear();
    this.ready = false;
  }

  async selectWorkspace(
    options?: WorkspaceSelectionOptions,
  ): Promise<WorkspaceSelectionResult> {
    if (!("showDirectoryPicker" in window)) {
      return {
        success: false,
        error: "当前浏览器不支持直接选择本地文件夹",
      };
    }

    try {
      const nextHandle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      const permission = await nextHandle.requestPermission({
        mode: "readwrite",
      });
      if (permission !== "granted") {
        return { success: false, error: "未获得文件夹读写权限" };
      }

      if (options?.beforeCommit && !(await options.beforeCommit())) {
        return { success: false, canceled: true };
      }

      this.directoryHandle = nextHandle;
      this.ready = true;
      await this.persistHandle(nextHandle);
      return {
        success: true,
        workspaceName: nextHandle.name,
      };
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return { success: false, canceled: true };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // --- 目录操作方法 ---

  async createFolder(
    folderPath: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      checkedPath(folderPath);
      await this.workspace().assertOrdinaryFolder(
        this.splitPath(folderPath).dir,
      );
      const parts = folderPath.split("/").filter(Boolean);
      if (parts.length === 0) {
        return { success: false, error: "文件夹名称不能为空" };
      }
      let current = this.ensureHandle();

      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const isLast = index === parts.length - 1;

        if (isLast) {
          try {
            await current.getDirectoryHandle(part);
            return { success: false, error: "文件夹已存在" };
          } catch (e: unknown) {
            const errorName = (e as { name?: string }).name;
            if (errorName && errorName !== "NotFoundError") {
              return {
                success: false,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }
        }

        // 逐级获取或创建目录，不进行特殊字符替换，因为 part 是路径的一部分
        current = await current.getDirectoryHandle(part, { create: true });
      }
      return { success: true, path: folderPath };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async moveFile(
    filePath: string,
    targetFolder: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }> {
    try {
      const packagePath = await this.articleAction(filePath, (w) =>
        w.operate(filePath, targetFolder),
      );
      if (packagePath !== null) return { success: true, newPath: packagePath };
      await this.workspace().assertOrdinaryFolder(targetFolder);
      const fileName = filePath.split("/").pop() || filePath;
      const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;

      if (filePath === newPath) return { success: true, newPath };

      let parent: FileSystemDirectoryHandle;
      let name: string;
      try {
        ({ parent, name } = await this.resolveParentAndName(newPath));
      } catch (e: unknown) {
        return { success: false, error: "目标文件夹不存在" };
      }

      try {
        await parent.getFileHandle(name);
        return { success: false, error: "目标位置已存在同名文件" };
      } catch (e: unknown) {
        const errorName = (e as { name?: string }).name;
        if (errorName && errorName !== "NotFoundError") {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      const content = await this.readFile(filePath);
      await this.writeFile(newPath, content);
      await this.deleteFile(filePath);
      return { success: true, newPath };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async deleteFolder(
    folderPath: string,
    options?: { recursive?: boolean },
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.workspace().assertNoPackages(folderPath);
      const { parent, name } = await this.resolveParentAndName(folderPath);
      const recursive = options?.recursive === true;

      if (!recursive) {
        // 检查是否为空
        const folderHandle = await parent.getDirectoryHandle(name);
        const entries = [];
        for await (const entry of folderHandle.values()) {
          entries.push(entry);
        }
        if (entries.length > 0) {
          return {
            success: false,
            error: "文件夹不为空，请先移出或删除其中的文件",
          };
        }
        await parent.removeEntry(name);
        return { success: true };
      }

      try {
        await parent.removeEntry(name, { recursive: true });
        return { success: true };
      } catch {
        const folderHandle = await parent.getDirectoryHandle(name);
        await deleteDirectoryRecursive(folderHandle);
        await parent.removeEntry(name);
      }
      return { success: true };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async renameFolder(
    oldPath: string,
    newPath: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }> {
    return this.moveFolderPath(
      this.normalizePath(oldPath),
      this.normalizePath(newPath),
    );
  }

  async moveFolder(
    folderPath: string,
    targetFolder: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }> {
    const normalizedPath = this.normalizePath(folderPath);
    const normalizedTarget = this.normalizePath(targetFolder);
    const folderName = normalizedPath.split("/").pop() || normalizedPath;
    const newPath = normalizedTarget
      ? `${normalizedTarget}/${folderName}`
      : folderName;
    return this.moveFolderPath(normalizedPath, newPath);
  }

  async inspectFolder(
    folderPath: string,
  ): Promise<{ success: boolean; entries?: string[]; error?: string }> {
    try {
      const handle = await this.resolveDirectoryHandle(
        this.normalizePath(folderPath),
      );
      const entries: string[] = [];
      for await (const entry of handle.values()) {
        if (entry.name.startsWith(".")) {
          entries.push(entry.name);
          continue;
        }
        if (entry.kind === "file" && !entry.name.endsWith(".md")) {
          entries.push(entry.name);
        }
      }
      return { success: true, entries };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // --- 辅助方法 ---

  /**
   * 解析路径获取文件 handle
   */
  private async resolveFileHandle(
    path: string,
    create = false,
  ): Promise<FileSystemFileHandle> {
    return resolveFileHandle(this.ensureHandle(), path, create);
  }

  /**
   * 解析路径获取父目录 handle 和名称
   */
  private async resolveParentAndName(
    path: string,
  ): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    return resolveParentAndName(this.ensureHandle(), path);
  }

  private async resolveDirectoryHandle(
    path: string,
  ): Promise<FileSystemDirectoryHandle> {
    return resolveDirectoryHandle(this.ensureHandle(), path);
  }

  private normalizePath(input: string): string {
    return normalizePath(input);
  }

  private splitPath(path: string): { dir: string; name: string } {
    return splitPath(path);
  }

  private async moveFolderPath(
    oldPath: string,
    newPath: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }> {
    try {
      const normalizedOld = this.normalizePath(oldPath);
      const normalizedNew = this.normalizePath(newPath);
      await this.workspace().assertNoPackages(normalizedOld);
      await this.workspace().assertOrdinaryFolder(
        this.splitPath(normalizedNew).dir,
      );

      if (normalizedOld === normalizedNew)
        return { success: true, newPath: oldPath };
      if (normalizedNew.startsWith(`${normalizedOld}/`)) {
        return { success: false, error: "不能移动到子文件夹" };
      }

      const { parent: oldParent, name: oldName } =
        await this.resolveParentAndName(normalizedOld);
      let sourceHandle: FileSystemDirectoryHandle;
      try {
        sourceHandle = await oldParent.getDirectoryHandle(oldName);
      } catch (e: unknown) {
        return { success: false, error: "文件夹不存在" };
      }

      let newParent: FileSystemDirectoryHandle;
      let newName: string;
      try {
        ({ parent: newParent, name: newName } =
          await this.resolveParentAndName(normalizedNew));
      } catch (e: unknown) {
        return { success: false, error: "目标文件夹不存在" };
      }

      try {
        await newParent.getDirectoryHandle(newName);
        return { success: false, error: "目标位置已存在同名文件夹" };
      } catch (e: unknown) {
        const errorName = (e as { name?: string }).name;
        if (errorName && errorName !== "NotFoundError") {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      try {
        await newParent.getFileHandle(newName);
        return { success: false, error: "目标位置已存在同名文件" };
      } catch (e: unknown) {
        const errorName = (e as { name?: string }).name;
        if (errorName && errorName !== "NotFoundError") {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      const targetHandle = await newParent.getDirectoryHandle(newName, {
        create: true,
      });
      await copyDirectoryRecursive(sourceHandle, targetHandle);

      try {
        await oldParent.removeEntry(oldName, { recursive: true });
      } catch {
        await deleteDirectoryRecursive(sourceHandle);
        await oldParent.removeEntry(oldName);
      }

      return { success: true, newPath: normalizedNew };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
