import type { StorageAdapter } from "../StorageAdapter";
import type { ArticleAsset } from "../articles/articleContract";
import { ArticleStorageError, digest } from "../articles/articleContract";
import { ServerArticleStore } from "../server/ServerArticleStore";
import {
  getServerClient,
  identityKey,
  uuid,
  isDefiniteRejection,
  type ServerClient,
} from "../server/serverClient";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
} from "../../utils/markdownFileMeta";
import {
  reportDirectoryIssue,
  useDirectoryStorageState,
} from "../../store/directoryStorageState";
import type { HistorySnapshot } from "../../store/historyTypes";

export class ServerStorageAdapter implements StorageAdapter {
  readonly type = "server" as const;
  readonly name = "服务器工作区";
  readonly supportsFolders = false;
  private stores = new Map<string, ServerArticleStore>();
  private writes = Promise.resolve();
  private unsubscribe: () => void;
  private disposed = false;
  private creation: { key: string; path: string; createdAt: string } | null =
    null;
  constructor(readonly client: ServerClient = getServerClient()) {
    this.unsubscribe = client.onInvalidate(() => {
      this.stores.clear();
      this.creation = null;
    });
  }
  get ready() {
    return !this.disposed && !!this.client.session;
  }
  getWorkspaceIdentity() {
    return this.client.session
      ? `${identityKey(this.client.session)}/${this.client.generation}`
      : null;
  }
  async init() {
    return {
      ready: await this.client.connect(),
      authenticationRequired: !this.client.session,
      message: "请登录服务器工作区",
    };
  }
  async teardown() {
    this.disposed = true;
    this.unsubscribe();
    this.stores.clear();
    this.creation = null;
  }
  private store(path: string) {
    if (!this.ready) throw new Error("服务器会话尚未就绪");
    const id = path.replace(/\/index\.md$/, "");
    if (!uuid(id) || path !== `${id}/index.md`)
      throw new Error("服务器文章路径无效");
    let store = this.stores.get(path);
    if (!store) {
      store = new ServerArticleStore(this.client, id);
      this.stores.set(path, store);
    }
    return store;
  }
  private action<T>(path: string, action: () => Promise<T>): Promise<T> {
    const identity = this.getWorkspaceIdentity();
    const run = async () => {
      if (!identity || identity !== this.getWorkspaceIdentity())
        throw new Error("工作区已变化");
      useDirectoryStorageState.setState((s) => ({
        pendingOperations: s.pendingOperations + 1,
      }));
      try {
        const result = await action();
        if (identity !== this.getWorkspaceIdentity())
          throw new Error("工作区已变化");
        if (useDirectoryStorageState.getState().issue?.path === path)
          useDirectoryStorageState.setState({ issue: null });
        return result;
      } catch (error) {
        if (identity === this.getWorkspaceIdentity())
          reportDirectoryIssue(identity, path, error);
        throw error;
      } finally {
        useDirectoryStorageState.setState((s) => ({
          pendingOperations: s.pendingOperations - 1,
        }));
      }
    };
    const task = this.writes.then(run);
    this.writes = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async listFiles() {
    return this.action("", async () => {
      const identity = this.getWorkspaceIdentity();
      const rows: {
        id: string;
        title: string;
        savedAt: string;
        revision: number;
      }[] = [];
      let after = "";
      for (let page = 0; page <= 10; page++) {
        const result = await this.client.json<typeof rows>(
          `/articles?limit=100${after ? `&after=${after}` : ""}`,
        );
        if (identity !== this.getWorkspaceIdentity())
          throw new Error("工作区已变化");
        if (
          !Array.isArray(result) ||
          result.length > 100 ||
          result.some(
            (r) =>
              !uuid(r.id) ||
              r.id <= after ||
              typeof r.title !== "string" ||
              !Number.isFinite(Date.parse(r.savedAt)),
          )
        )
          throw new Error("服务器文章列表无效");
        rows.push(...result);
        if (result.length < 100)
          return rows.map((r) => ({
            path: `${r.id}/index.md`,
            name: `${r.title}.md`,
            updatedAt: r.savedAt,
            meta: { title: r.title, articlePackage: true },
          }));
        after = result[result.length - 1].id;
      }
      throw new Error("服务器文章列表超过能力限制");
    });
  }
  readFile(path: string) {
    return this.action(path, async () => {
      const snapshot = await this.store(path).read();
      if (this.creation?.path === path) this.creation = null;
      return snapshot.article.markdown;
    });
  }
  writeFile(path: string, markdown: string) {
    return this.action(path, async () => {
      const store = this.store(path),
        before = store.snapshot;
      if (!before)
        throw new ArticleStorageError("conflict", "请先打开文章后保存");
      const meta = parseMarkdownFileContent(markdown);
      await store.commit(
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
    });
  }
  getArticleAssets(path: string) {
    const value = this.store(path).snapshot;
    if (!value) throw new Error("请先打开文章资源快照");
    return value.assets.map((a) => ({ ...a }));
  }
  async readArticleAssetsForExport(path: string) {
    return this.getArticleAssets(path);
  }
  appendArticleAssets(path: string, assets: ArticleAsset[]) {
    return this.action(path, async () => {
      const store = this.store(path),
        before = store.snapshot;
      if (!before) throw new Error("请先打开文章");
      await store.commit(
        { article: before.article, assets: [...before.assets, ...assets] },
        before.revision,
      );
    });
  }
  createArticle(
    content: string,
    title: string,
    folderPath = "",
    assets: ArticleAsset[] = [],
    source?: HistorySnapshot,
  ) {
    return this.action("", async () => {
      if (folderPath) throw new Error("服务器工作区不支持文件夹");
      const key = JSON.stringify([
        content,
        title,
        source,
        await Promise.all(
          assets.map(async (a) => [a.path, await digest(a.bytes)]),
        ),
      ]);
      if (this.creation && this.creation.key !== key)
        throw new Error(
          "上次新建结果尚未确认，请重试原操作，或从列表打开核对后再新建",
        );
      this.creation ??= {
        key,
        path: `${crypto.randomUUID()}/index.md`,
        createdAt: new Date().toISOString(),
      };
      const path = this.creation.path,
        store = this.store(path),
        now = this.creation.createdAt;
      const meta = parseMarkdownFileContent(content);
      await store
        .commit(
          {
            article: {
              ...source,
              id: store.articleId,
              title,
              markdown: content,
              theme: meta.theme,
              themeName: meta.themeName,
              customCSS: source?.customCSS ?? "",
              createdAt: now,
              savedAt: now,
            },
            assets,
          },
          null,
        )
        .catch((error) => {
          if (
            isDefiniteRejection(error) ||
            (error instanceof ArticleStorageError &&
              ["invalid", "capacity"].includes(error.code))
          ) {
            this.creation = null;
            this.stores.delete(path);
          }
          throw error;
        });
      this.creation = null;
      return path;
    });
  }
  async saveArticleConflictCopy(path: string, content: string) {
    const assets = this.getArticleAssets(path);
    const title = `${parseMarkdownFileContent(content).title || "未命名文章"}（冲突副本）`;
    content = applyMarkdownFileMeta(content, { title });
    return {
      path: await this.createArticle(
        content,
        title,
        "",
        assets,
        this.store(path).snapshot!.article,
      ),
      content,
      title,
    };
  }
  forgetArticleRead(path: string) {
    this.stores.delete(path);
  }
  deleteFile(path: string) {
    return this.action(path, async () => {
      await this.store(path).delete();
      this.stores.delete(path);
    });
  }
  async renameFile(): Promise<void> {
    throw new Error("服务器文章通过标题重命名，不能改变文章 ID");
  }
  async exists(path: string) {
    return (await this.listFiles()).some((row) => row.path === path);
  }
}
