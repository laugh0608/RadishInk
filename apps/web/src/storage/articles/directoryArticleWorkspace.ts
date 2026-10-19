import type { FileItem } from "../types";
import type { ArticleSnapshot, ArticleAsset } from "./articleContract";
import {
  ArticleStorageError,
  packageDirectoryName,
  assertRevision,
  digest,
} from "./articleContract";
import { DirectoryArticleStore } from "./directoryArticleStore";
import {
  optionalFile,
  optionalDirectory,
  readJson,
  readText,
  validateManifest,
  verifyManifest,
} from "./directoryArticleIO";
import {
  resolveDirectoryHandle,
  resolveParentAndName,
  scanDirectory,
} from "../adapters/fileSystemAdapterHelpers";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
  stripMarkdownExtension,
} from "../../utils/markdownFileMeta";
import {
  DIRECTORY_LOCK,
  checkedPath,
  beginPackageOperation,
  listPackageOperations,
  resumePackageOperation,
  cleanupPackageOperation,
} from "./directoryPackageOperations";

export class DirectoryArticleWorkspace {
  private snapshots = new Map<string, ArticleSnapshot>();
  private writes = Promise.resolve();
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.writes.then(work);
    this.writes = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  getAssets(path: string): ArticleAsset[] {
    const snapshot = this.snapshots.get(path);
    if (!snapshot)
      throw new Error(
        "请先打开文章包；旧单文件需从目录维护入口显式复制为文章目录",
      );
    return snapshot.assets.map((asset) => ({ ...asset }));
  }
  async readAssetsForExport(path: string) {
    const before = this.snapshots.get(path);
    const package_ = await this.descriptor(path);
    if (!before || !package_) throw new Error("请先打开文章包");
    const current = await package_.store.read();
    if (!current) throw new Error("文章包不存在或需要恢复");
    assertRevision(current.revision, before.revision);
    return current.assets;
  }
  appendAssets(path: string, assets: ArticleAsset[]): Promise<void> {
    return this.enqueue(async () => {
      const before = this.snapshots.get(path);
      const package_ = await this.descriptor(path);
      if (!before || !package_)
        throw new ArticleStorageError("conflict", "请先打开文章包");
      const saved = await package_.store.commit(
        { article: before.article, assets: [...before.assets, ...assets] },
        before.revision,
      );
      this.snapshots.set(path, saved);
    });
  }
  constructor(
    readonly root: FileSystemDirectoryHandle,
    private readonly locks:
      | Pick<LockManager, "request">
      | undefined = navigator.locks,
  ) {}
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.locks)
      return Promise.reject(
        new ArticleStorageError(
          "unsupported",
          "当前环境缺少 Web Locks，目录文章写入暂停",
        ),
      );
    return this.locks.request(DIRECTORY_LOCK, fn);
  }
  private async descriptor(path: string) {
    checkedPath(path);
    if (!path.endsWith("/index.md")) return null;
    const directoryPath = path.slice(0, -9);
    const { parent, name } = await resolveParentAndName(
      this.root,
      directoryPath,
    );
    const folder = await optionalDirectory(parent, name);
    if (!folder) return null;
    const owner = (await readJson(folder, ".radishink-owner.json")) as {
      format?: number;
      articleId?: string;
    } | null;
    if (!owner) return null;
    if (
      owner.format !== 1 ||
      typeof owner.articleId !== "string" ||
      !owner.articleId
    )
      throw new ArticleStorageError("invalid", "文章身份记录损坏");
    return {
      directoryPath,
      folder,
      store: new DirectoryArticleStore(
        parent,
        name,
        owner.articleId,
        this.locks,
      ),
    };
  }
  forgetRead(path: string) {
    this.snapshots.delete(path);
  }
  async isPackage(path: string) {
    return !!(await this.descriptor(path));
  }
  async list(): Promise<FileItem[]> {
    await this.assertOrdinaryFolder("");
    return scanDirectory(this.root, "", async (folder, path) => {
      const owner = await optionalFile(folder, ".radishink-owner.json");
      if (!owner) return null;
      const descriptor = await this.descriptor(`${path}/index.md`);
      if (!descriptor)
        throw new ArticleStorageError("invalid", `文章包身份损坏：${path}`);
      const control = await optionalDirectory(folder, ".radishink");
      const pending =
        control &&
        ((await readJson(control, "pending.json")) as {
          after?: unknown;
        } | null);
      const state = control && (await readJson(control, "state.json"));
      const value = state || pending?.after;
      let title = folder.name;
      let savedAt: string | undefined;
      let themeName: string | undefined;
      if (value) {
        validateManifest(value, descriptor.store.articleId);
        title = value.article.title || title;
        savedAt = value.article.savedAt;
        themeName = value.article.themeName;
      }
      return {
        path: `${path}/index.md`,
        name: `${title}.md`,
        updatedAt: savedAt,
        meta: {
          title,
          themeName,
          articlePackage: true,
          recoveryRequired: !!pending || !state,
        },
      };
    });
  }
  async read(path: string) {
    const package_ = await this.descriptor(path);
    if (!package_) return null;
    const value = await package_.store.read();
    if (!value)
      throw new ArticleStorageError(
        "recovery-required",
        "文章创建未完成，请从目录维护入口重试或检查暂存文件",
      );
    this.snapshots.set(path, value);
    return value.article.markdown;
  }
  write(path: string, markdown: string) {
    return this.enqueue(() => this.writeContent(path, markdown));
  }
  private async writeContent(path: string, markdown: string) {
    const package_ = await this.descriptor(path);
    if (!package_) return false;
    const before = this.snapshots.get(path);
    if (!before)
      throw new ArticleStorageError(
        "conflict",
        "文章尚未读取，请先打开后再保存",
      );
    const meta = parseMarkdownFileContent(markdown);
    const result = await package_.store.commit(
      {
        article: {
          ...before.article,
          markdown,
          title: meta.title || before.article.title,
          theme: meta.theme,
          themeName: meta.themeName,
          savedAt: new Date().toISOString(),
        },
        assets: before.assets,
      },
      before.revision,
    );
    this.snapshots.set(path, result);
    return true;
  }
  async create(
    markdown: string,
    title: string,
    folderPath = "",
    sourcePath?: string,
    assets: ArticleAsset[] = [],
  ) {
    if (folderPath) checkedPath(folderPath);
    await this.assertOrdinaryFolder(folderPath);
    const parent = await resolveDirectoryHandle(this.root, folderPath);
    const id = crypto.randomUUID();
    const name = await packageDirectoryName(title, id);
    const store = new DirectoryArticleStore(parent, name, id, this.locks);
    const meta = parseMarkdownFileContent(markdown);
    const now = new Date().toISOString();
    const article = {
      id,
      title,
      markdown,
      theme: meta.theme,
      themeName: meta.themeName,
      customCSS: "",
      createdAt: now,
      savedAt: now,
    };
    const value = sourcePath
      ? await store.copyLegacy(sourcePath, article)
      : await store.commit({ article, assets }, null);
    const path = `${folderPath ? `${folderPath}/` : ""}${name}/index.md`;
    this.snapshots.set(path, value);
    return path;
  }
  async copyLegacy(path: string) {
    checkedPath(path);
    if (await this.isPackage(path))
      throw new ArticleStorageError("invalid", "该文章已经是文章包");
    const { parent, name } = await resolveParentAndName(this.root, path);
    const file = await optionalFile(parent, name);
    if (!file) throw new ArticleStorageError("conflict", "旧文已不存在");
    const markdown = await readText(file);
    // 输出在工作区根目录，sourcePath 始终相对同一个已授权根目录。
    return this.create(
      markdown,
      parseMarkdownFileContent(markdown).title || stripMarkdownExtension(name),
      "",
      path,
    );
  }
  async saveConflictCopy(path: string, markdown: string) {
    const before = this.snapshots.get(path);
    if (!before) {
      if (await this.isPackage(path))
        throw new ArticleStorageError(
          "conflict",
          "缺少已读取的资源快照，请先下载正文，不能假定资源为空",
        );
      const title = `${parseMarkdownFileContent(markdown).title || "未命名文章"}（冲突副本）`;
      const content = applyMarkdownFileMeta(markdown, { title });
      return { path: await this.create(content, title), title, content };
    }
    const id = crypto.randomUUID();
    const title = `${before.article.title || "未命名文章"}（冲突副本）`;
    const directory = await packageDirectoryName(title, id);
    const content = applyMarkdownFileMeta(markdown, { title });
    const store = new DirectoryArticleStore(
      this.root,
      directory,
      id,
      this.locks,
    );
    const now = new Date().toISOString();
    const saved = await store.commit(
      {
        article: {
          ...before.article,
          id,
          title,
          markdown: content,
          createdAt: now,
          savedAt: now,
        },
        assets: before.assets,
      },
      null,
    );
    const nextPath = `${directory}/index.md`;
    this.snapshots.set(nextPath, saved);
    return { path: nextPath, content, title };
  }
  async recover(path: string) {
    const package_ = await this.descriptor(path);
    if (!package_)
      throw new ArticleStorageError("invalid", "不是受管理的文章包");
    const value = await package_.store.recover();
    if (!value)
      throw new ArticleStorageError(
        "recovery-required",
        "尚未发布写入日志，请保留目录并重新创建文章；暂存文件可在磁盘检查",
      );
    this.snapshots.delete(path); // 恢复不能偷偷替换编辑器基线，须显式重新打开。
  }
  async assertOrdinaryFolder(path: string) {
    let current = this.root;
    if (await optionalFile(current, ".radishink-owner.json"))
      throw new ArticleStorageError(
        "invalid",
        "请选择工作区父目录，不能把单篇文章包用作工作区",
      );
    if (path) checkedPath(path);
    for (const part of path ? path.split("/") : []) {
      current = await current.getDirectoryHandle(part);
      if (await optionalFile(current, ".radishink-owner.json"))
        throw new ArticleStorageError(
          "invalid",
          "不能在文章包内部执行普通文件或文件夹操作",
        );
    }
  }
  async assertNoPackages(path: string) {
    checkedPath(path);
    await this.assertOrdinaryFolder(path);
    const scan = async (folder: FileSystemDirectoryHandle): Promise<void> => {
      if (await optionalFile(folder, ".radishink-owner.json"))
        throw new ArticleStorageError(
          "invalid",
          "该文件夹包含文章包，请逐篇移动或删除文章",
        );
      for await (const entry of folder.values())
        if (entry.kind === "directory")
          await scan(await folder.getDirectoryHandle(entry.name));
    };
    await scan(await resolveDirectoryHandle(this.root, path));
  }
  async operate(path: string, targetFolder: string | null) {
    const package_ = await this.descriptor(path);
    if (!package_) return null;
    const before = this.snapshots.get(path);
    if (!before)
      throw new ArticleStorageError(
        "conflict",
        "请先打开文章确认内容，再移动或删除",
      );
    if (targetFolder !== null) await this.assertOrdinaryFolder(targetFolder);
    // store.read 自带锁；在生命周期锁内重做版本与全部资源校验。
    const current = await package_.store.read();
    assertRevision(current?.revision ?? null, before.revision);
    const newDirectory =
      targetFolder === null
        ? null
        : `${targetFolder ? `${targetFolder}/` : ""}${package_.folder.name}`;
    await this.locked(async () => {
      const control = await package_.folder.getDirectoryHandle(".radishink");
      if (await readJson(control, "pending.json"))
        throw new ArticleStorageError(
          "recovery-required",
          "先恢复文章写入再操作整包",
        );
      const state = await readJson(control, "state.json");
      validateManifest(state, before.article.id);
      assertRevision(state.revision, before.revision);
      await verifyManifest(package_.folder, state);
      // 不删除陌生文件；图片清理必须另行显式列出候选。
      for await (const entry of package_.folder.values())
        if (
          ![
            "index.md",
            "asset",
            ".radishink",
            ".radishink-owner.json",
          ].includes(entry.name)
        )
          throw new ArticleStorageError(
            "conflict",
            "文章包包含未知文件，请先检查，未移动或删除",
          );
      const assets = await package_.folder.getDirectoryHandle("asset");
      for await (const entry of assets.values())
        if (
          entry.kind !== "file" ||
          !state.assets.some((a) => a.path === `asset/${entry.name}`)
        )
          throw new ArticleStorageError(
            "conflict",
            "资源目录含未登记文件，请先检查",
          );
      await beginPackageOperation(
        this.root,
        package_.directoryPath,
        newDirectory,
      );
    });
    this.snapshots.delete(path);
    if (newDirectory) this.snapshots.set(`${newDirectory}/index.md`, before);
    return newDirectory ? `${newDirectory}/index.md` : "";
  }
  operations() {
    return listPackageOperations(this.root);
  }
  recoverOperation(id: string) {
    return this.locked(() => resumePackageOperation(this.root, id));
  }
  cleanupOperation(id: string) {
    return this.locked(() => cleanupPackageOperation(this.root, id));
  }
  async cleanupHistory(path: string) {
    const package_ = await this.descriptor(path);
    if (!package_) throw new ArticleStorageError("invalid", "不是文章包");
    await package_.store.read();
    return this.locked(async () => {
      const control = await package_.folder.getDirectoryHandle(".radishink");
      if (await readJson(control, "pending.json"))
        throw new ArticleStorageError(
          "recovery-required",
          "未完成日志不能清理",
        );
      const state = await readJson(control, "state.json");
      validateManifest(state, package_.store.articleId);
      let count = 0;
      for await (const entry of control.values()) {
        if (entry.kind !== "directory" || !/^[a-f0-9-]{36}$/.test(entry.name))
          continue;
        const stage = await control.getDirectoryHandle(entry.name);
        const journal = (await readJson(stage, "journal.json")) as {
          articleId?: string;
          after?: unknown;
        } | null;
        if (!journal || journal.articleId !== package_.store.articleId)
          continue;
        validateManifest(journal.after, package_.store.articleId);
        if (journal.after.revision > state.revision) continue;
        const allowed = new Set([
          "journal.json",
          ...journal.after.assets.map((a) => a.path.slice(6)),
        ]);
        for await (const child of stage.values())
          if (child.kind !== "file" || !allowed.has(child.name))
            throw new ArticleStorageError(
              "conflict",
              "暂存目录含未知文件，不自动清理",
            );
        for (const asset of journal.after.assets) {
          const bytes = await optionalFile(stage, asset.path.slice(6));
          if (!bytes || (await digest(bytes)) !== asset.hash)
            throw new ArticleStorageError(
              "conflict",
              "暂存资源已改变，不自动清理",
            );
        }
        await control.removeEntry(entry.name, { recursive: true });
        count++;
      }
      return count;
    });
  }
}
