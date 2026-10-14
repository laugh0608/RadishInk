import { openDB, wrap, type DBSchema, type IDBPDatabase } from "idb";
import type { HistorySnapshot } from "../../store/historyTypes";
import {
  ARTICLE_LIMIT,
  ArticleStorageError,
  assertPrototypeName,
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
  assertPrototypeName(databaseName);
  const db = await openDB(databaseName, undefined, {
    upgrade(_db, _old, _next, tx) {
      tx.abort();
    },
  });
  try {
    if (db.version !== 2 || !db.objectStoreNames.contains("history")) {
      throw new ArticleStorageError(
        "unsupported",
        "只接受现有 v2 history 数据库的合成副本",
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

function validateBackup(backup: HistoryBackup, name: string) {
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
    const article = normalizeLegacyArticle(row.value);
    if (article.id !== row.key || ids.has(row.key))
      throw new ArticleStorageError(
        "invalid",
        "迁移备份包含重复或错误的文章键",
      );
    ids.add(row.key);
  }
}

/** 只升级合成副本，生产 historyDb 的版本和入口保持不变。 */
export async function openBrowserArticlePrototype(
  databaseName: string,
  externalBackup: HistoryBackup,
) {
  assertPrototypeName(databaseName);
  const backup = structuredClone(externalBackup);
  validateBackup(backup, databaseName);
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
        event.oldVersion !== 2 ||
        !db.objectStoreNames.contains("history")
      ) {
        fail(
          new ArticleStorageError(
            "unsupported",
            "必须从已备份的 v2 合成数据库升级",
          ),
        );
        return;
      }
      try {
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
              if (JSON.stringify(records) !== JSON.stringify(backup.records)) {
                throw new ArticleStorageError(
                  "conflict",
                  "备份后文章发生变化，升级已中止，请重新备份",
                );
              }
              migration.put(backup, "v2-backup");
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
    if (JSON.stringify(saved) !== JSON.stringify(backup))
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
    close() {
      invalidated = true;
      db.close();
    },
  };
}

/** 失败恢复演练：把升级前备份还原到新的合成 v2 库，绝不降级或清空原库。 */
export async function restoreHistoryBackup(
  backupInput: HistoryBackup,
  destination: string,
) {
  assertPrototypeName(destination);
  const backup = structuredClone(backupInput);
  validateBackup(backup, backup.databaseName);
  await new Promise<void>((resolve, reject) => {
    let created = false;
    let canceled = false;
    let restoreError: unknown;
    const request = indexedDB.open(destination, 2);
    request.onblocked = () => {
      canceled = true;
      reject(
        new ArticleStorageError(
          "blocked",
          "恢复目标被占用，请选择新的合成数据库",
        ),
      );
    };
    request.onerror = () => reject(restoreError ?? request.error);
    request.onupgradeneeded = (event) => {
      if (canceled || event.oldVersion !== 0) {
        restoreError = new ArticleStorageError("conflict", "恢复目标已存在");
        request.transaction!.abort();
        return;
      }
      created = true;
      const store = request.result.createObjectStore("history");
      for (const record of backup.records) store.put(record.value, record.key);
    };
    request.onsuccess = () => {
      request.result.close();
      if (canceled) return;
      if (!created)
        reject(new ArticleStorageError("conflict", "恢复目标已存在"));
      else resolve();
    };
  });
}
