import { openDB, wrap, type DBSchema, type IDBPDatabase } from "idb";
import type { HistorySnapshot } from "../../store/historyTypes";
import {
  ARTICLE_LIMIT,
  ArticleStorageError,
  assertRevision,
  digest,
  normalizeLegacyArticle,
  validateContent,
  type ArticleContent,
  type ArticleSnapshot,
  type ArticleStore,
} from "./articleContract";

export interface HistoryBackup {
  format: "p2a-history-backup/1";
  databaseName: string;
  version: 2;
  records: { key: string; value: HistorySnapshot }[];
}

interface StoredAsset {
  articleId: string;
  path: string;
  bytes: Blob;
  hash: string;
}

interface ArticleDB extends DBSchema {
  history: { key: string; value: HistorySnapshot };
  articleRevisions: { key: string; value: number };
  articleAssets: {
    key: [string, string];
    value: StoredAsset;
    indexes: { articleId: string };
  };
  articleMigration: { key: string; value: HistoryBackup };
}

/** 升级前独立导出；调用方必须持有此副本，不能用升级后的库充当唯一备份。 */
export async function readHistoryBackup(
  databaseName: string,
): Promise<HistoryBackup> {
  const db = await openDB(databaseName, undefined, {
    upgrade(_db, _old, _next, tx) {
      tx.abort();
    },
  });
  try {
    if (db.version !== 2 || !db.objectStoreNames.contains("history")) {
      throw new ArticleStorageError(
        "unsupported",
        "只接受现有 v2 history 数据库",
      );
    }
    const tx = db.transaction("history", "readonly");
    const [keys, rows] = await Promise.all([
      tx.store.getAllKeys(),
      tx.store.getAll(),
    ]);
    await tx.done;
    const records = rows.map((value, index) => {
      const normalized = normalizeLegacyArticle(value);
      if (keys[index] !== normalized.id)
        throw new ArticleStorageError("invalid", "历史键与文章 ID 不一致");
      return { key: normalized.id, value: value as HistorySnapshot };
    });
    return {
      format: "p2a-history-backup/1",
      databaseName,
      version: 2,
      records,
    };
  } finally {
    db.close();
  }
}

export function validateBackup(backup: HistoryBackup, name: string) {
  if (!backup || typeof backup !== "object")
    throw new ArticleStorageError("invalid", "备份必须是 JSON 对象");
  if (
    backup.format !== "p2a-history-backup/1" ||
    backup.version !== 2 ||
    backup.databaseName !== name ||
    !Array.isArray(backup.records)
  ) {
    throw new ArticleStorageError("invalid", "迁移备份格式或归属不匹配");
  }
  const ids = new Set<string>();
  for (const row of backup.records) {
    if (!row || typeof row !== "object")
      throw new ArticleStorageError("invalid", "备份记录无效");
    const article = normalizeLegacyArticle(row.value);
    if (article.id !== row.key || ids.has(row.key))
      throw new ArticleStorageError(
        "invalid",
        "迁移备份包含重复或错误的文章键",
      );
    ids.add(row.key);
  }
}

/** 探测不存在的库时中止创建，不能为了检测版本就改变旧数据库。 */
async function databaseVersion(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let missing = false;
    let canceled = false;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction!.abort();
    };
    request.onerror = () => (missing ? resolve(0) : reject(request.error));
    request.onblocked = () => {
      canceled = true;
      reject(
        new ArticleStorageError(
          "blocked",
          "数据库正在被其他标签页升级，请关闭占用页面后重试",
        ),
      );
    };
    request.onsuccess = () => {
      const version = request.result.version;
      request.result.close();
      if (!canceled) resolve(version);
    };
  });
}

/** 新库直接初始化；已有 v2 必须提供独立备份，v3 只读校验迁移标记。 */
export async function openBrowserArticleDatabase(
  databaseName: string,
  externalBackup?: HistoryBackup,
  onInvalidated?: () => void,
) {
  if (!externalBackup) {
    const version = await databaseVersion(databaseName);
    if (version === 2)
      throw new ArticleStorageError(
        "upgrade-required",
        "旧文章需要先下载备份并确认升级",
      );
    if (version !== 0 && version !== 3)
      throw new ArticleStorageError(
        "unsupported",
        `不支持数据库版本 ${version}，请使用兼容版本；当前版本不会改写数据`,
      );
  }
  const backup = externalBackup && structuredClone(externalBackup);
  if (backup) validateBackup(backup, databaseName);
  let invalidated = false;
  const raw = await new Promise<IDBDatabase>((resolve, reject) => {
    let canceled = false;
    let migrationError: unknown;
    const request = indexedDB.open(databaseName, 3);
    request.onblocked = () => {
      canceled = true;
      reject(
        new ArticleStorageError(
          "blocked",
          "旧标签页占用数据库，请关闭后重新发起升级",
        ),
      );
    };
    request.onerror = () => reject(migrationError ?? request.error);
    request.onsuccess = () => {
      if (canceled) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      const fail = (error: unknown) => {
        migrationError = error;
        tx.abort();
      };
      if (
        canceled ||
        (event.oldVersion !== 0 && event.oldVersion !== 2) ||
        (event.oldVersion === 2 && !backup)
      ) {
        fail(
          new ArticleStorageError(
            event.oldVersion === 2 ? "upgrade-required" : "unsupported",
            "旧文章需要先下载备份并确认升级",
          ),
        );
        return;
      }
      try {
        if (event.oldVersion === 0) db.createObjectStore("history");
        const revisions = db.createObjectStore("articleRevisions");
        const assets = db.createObjectStore("articleAssets");
        assets.createIndex("articleId", "articleId");
        const migration = db.createObjectStore("articleMigration");
        const history = tx.objectStore("history");
        const records: HistoryBackup["records"] = [];
        const cursorRequest = history.openCursor();
        cursorRequest.onsuccess = () => {
          try {
            const cursor = cursorRequest.result;
            if (cursor) {
              const article = normalizeLegacyArticle(cursor.value);
              if (cursor.key !== article.id)
                throw new ArticleStorageError(
                  "invalid",
                  "历史键与文章 ID 不一致",
                );
              records.push({ key: article.id, value: cursor.value });
              revisions.put(0, article.id);
              cursor.continue();
            } else {
              if (
                backup &&
                JSON.stringify(records) !== JSON.stringify(backup.records)
              ) {
                throw new ArticleStorageError(
                  "conflict",
                  "备份后文章发生变化，升级已中止，请重新备份",
                );
              }
              migration.put(
                backup ?? {
                  format: "p2a-history-backup/1",
                  databaseName,
                  version: 2,
                  records: [],
                },
                "v2-backup",
              );
            }
          } catch (error) {
            fail(error);
          }
        };
      } catch (error) {
        fail(error);
      }
    };
  });
  raw.onversionchange = () => {
    invalidated = true;
    raw.close();
    onInvalidated?.();
  };
  const db = wrap(raw) as IDBPDatabase<ArticleDB>;
  const ensureOpen = () => {
    if (invalidated)
      throw new ArticleStorageError(
        "unsupported",
        "数据库已关闭或有新版接管，请停止写入并重新打开",
      );
  };
  // 已升级库再次打开也校验迁移标记，拒绝不完整/不兼容的库。
  try {
    const saved = await db.get("articleMigration", "v2-backup");
    if (!saved) throw new ArticleStorageError("invalid", "缺少迁移完成记录");
    validateBackup(saved, databaseName);
    if (backup && JSON.stringify(saved) !== JSON.stringify(backup))
      throw new ArticleStorageError(
        "conflict",
        "传入备份与该库的迁移来源不一致",
      );
  } catch (error) {
    db.close();
    throw error;
  }

  function article(articleId: string): ArticleStore {
    const read = async (): Promise<ArticleSnapshot | null> => {
      ensureOpen();
      const tx = db.transaction(
        ["history", "articleRevisions", "articleAssets"],
        "readonly",
      );
      const [row, revision, assets] = await Promise.all([
        tx.objectStore("history").get(articleId),
        tx.objectStore("articleRevisions").get(articleId),
        tx.objectStore("articleAssets").index("articleId").getAll(articleId),
      ]);
      await tx.done;
      if (!row && revision === undefined && !assets.length) return null;
      if (!row || revision === undefined)
        throw new ArticleStorageError("invalid", "文章与资源索引不完整");
      assertRevision(revision, revision);
      for (const asset of assets) {
        if ((await digest(asset.bytes)) !== asset.hash)
          throw new ArticleStorageError("invalid", "资源字节校验失败");
      }
      const result = {
        article: normalizeLegacyArticle(row),
        revision,
        assets: assets.map(({ path, bytes }) => ({ path, bytes })),
      };
      validateContent(result, articleId);
      return result;
    };
    return {
      articleId,
      read,
      recover: read,
      async commit(input: ArticleContent, expectedRevision) {
        const content = {
          article: structuredClone(input.article),
          assets: input.assets.map((asset) => ({ ...asset })),
        };
        validateContent(content, articleId);
        // 哈希在事务前完成，不能在 IndexedDB 事务中等待非数据库异步 IO。
        const assets: StoredAsset[] = await Promise.all(
          content.assets.map(async (asset) => ({
            ...asset,
            articleId,
            hash: await digest(asset.bytes),
          })),
        );
        ensureOpen();
        const tx = db.transaction(
          ["history", "articleRevisions", "articleAssets"],
          "readwrite",
        );
        const done = tx.done;
        // 立即接住 abort；最后仍 await 原 promise，绝不把中止报告为成功。
        void done.catch(() => {});
        try {
          const revisions = tx.objectStore("articleRevisions");
          const currentRevision = await revisions.get(articleId);
          assertRevision(currentRevision ?? null, expectedRevision);
          const current = await tx.objectStore("history").get(articleId);
          if ((current === undefined) !== (currentRevision === undefined))
            throw new ArticleStorageError("invalid", "文章版本索引不完整");
          if (
            !current &&
            (await tx.objectStore("history").count()) >= ARTICLE_LIMIT
          )
            throw new ArticleStorageError(
              "capacity",
              "已达到 30 篇文章上限，请先导出并显式删除文章",
            );
          if (
            current &&
            normalizeLegacyArticle(current).createdAt !==
              content.article.createdAt
          )
            throw new ArticleStorageError(
              "invalid",
              "保存不能改变文章创建时间",
            );
          const previous = await tx
            .objectStore("articleAssets")
            .index("articleId")
            .getAll(articleId);
          for (const old of previous) {
            if (
              !assets.some(
                (asset) => asset.path === old.path && asset.hash === old.hash,
              )
            )
              throw new ArticleStorageError(
                "conflict",
                "已有资源不可覆盖或隐式删除；移除引用仍保留撤销所需字节",
              );
          }
          const revision = (currentRevision ?? -1) + 1;
          // 当前 UI 只认识已声明字段；后续保存也不能抹掉旧记录的扩展字段。
          content.article = { ...current, ...content.article };
          await tx.objectStore("history").put(content.article, articleId);
          for (const asset of assets)
            await tx
              .objectStore("articleAssets")
              .put(asset, [articleId, asset.path]);
          await revisions.put(revision, articleId);
          await done;
          return { ...content, revision };
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* 已中止或提交，原始错误仍向调用方传播。 */
          }
          await done.catch(() => {});
          throw error;
        }
      },
    };
  }
  return {
    article,
    async list() {
      ensureOpen();
      const ids = await db.getAllKeys("history");
      return Promise.all(
        ids.map(async (id) => {
          const value = await article(id).read();
          if (!value)
            throw new ArticleStorageError(
              "conflict",
              "文章列表已变化，请重试读取",
            );
          return value;
        }),
      );
    },
    async mergeBackup(input: HistoryBackup, expected: Map<string, number>) {
      const backup = structuredClone(input);
      validateBackup(backup, databaseName);
      ensureOpen();
      const tx = db.transaction(["history", "articleRevisions"], "readwrite");
      const done = tx.done;
      void done.catch(() => {});
      try {
        const rows = tx.objectStore("history");
        const revisions = tx.objectStore("articleRevisions");
        const ids = await rows.getAllKeys();
        if (ids.length !== expected.size || ids.some((id) => !expected.has(id)))
          throw new ArticleStorageError(
            "conflict",
            "恢复预览后文章列表已变化，请重新预览",
          );
        for (const [id, revision] of expected)
          assertRevision((await revisions.get(id)) ?? null, revision);
        let imported = 0;
        let skipped = 0;
        for (const record of backup.records) {
          if (expected.has(record.key)) {
            skipped++;
            continue;
          }
          // 旧备份恢复与旧库升级一样保留全部旧文，不受新建上限裁剪。
          await rows.put(record.value, record.key);
          await revisions.put(0, record.key);
          imported++;
        }
        await done;
        return { imported, skipped };
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* 保留原错误。 */
        }
        await done.catch(() => {});
        throw error;
      }
    },
    async remove(expected: Map<string, number>, all = false) {
      ensureOpen();
      const tx = db.transaction(
        ["history", "articleRevisions", "articleAssets"],
        "readwrite",
      );
      const done = tx.done;
      void done.catch(() => {});
      try {
        if (all) {
          const ids = await tx.objectStore("history").getAllKeys();
          if (
            ids.length !== expected.size ||
            ids.some((id) => !expected.has(id))
          )
            throw new ArticleStorageError(
              "conflict",
              "文章列表已变化，未清空任何文章",
            );
        }
        for (const [id, revision] of expected) {
          assertRevision(
            (await tx.objectStore("articleRevisions").get(id)) ?? null,
            revision,
          );
          const keys = await tx
            .objectStore("articleAssets")
            .index("articleId")
            .getAllKeys(id);
          for (const key of keys)
            await tx.objectStore("articleAssets").delete(key);
          await tx.objectStore("history").delete(id);
          await tx.objectStore("articleRevisions").delete(id);
        }
        await done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* 保留原始错误。 */
        }
        await done.catch(() => {});
        throw error;
      }
    },
    close() {
      invalidated = true;
      db.close();
    },
  };
}
