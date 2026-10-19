import type { HistorySnapshot } from "./historyTypes";
import { useHistoryStorageState } from "./historyStorageState";
import {
  openBrowserArticleDatabase,
  readHistoryBackup,
  type HistoryBackup,
} from "../storage/articles/browserArticleDatabase";
import {
  ArticleStorageError,
  normalizeLegacyArticle,
  type ArticleSnapshot,
  type ArticleAsset,
} from "../storage/articles/articleContract";

const DB_NAME = "wemd-history";
type Database = Awaited<ReturnType<typeof openBrowserArticleDatabase>>;
let database: Promise<Database> | null = null;
// 保存使用实际读到的版本，不能在写入前重读版本再覆盖另一标签页的更改。
const snapshots = new Map<string, ArticleSnapshot>();

export function getHistoryAssets(id: string): ArticleAsset[] {
  const snapshot = snapshots.get(id);
  if (!snapshot) throw new Error("文章资源尚未读取");
  return snapshot.assets.map((asset) => ({ ...asset }));
}

export async function appendHistoryAssets(id: string, assets: ArticleAsset[]) {
  const previous = snapshots.get(id);
  if (!previous)
    throw new ArticleStorageError("conflict", "文章尚未读取或已被删除");
  const db = await writableDatabase();
  const saved = await db
    .article(id)
    .commit(
      { article: previous.article, assets: [...previous.assets, ...assets] },
      previous.revision,
    );
  snapshots.set(id, saved);
}

function reportInitializationError(error: unknown) {
  useHistoryStorageState.setState({
    status:
      error instanceof ArticleStorageError && error.code === "upgrade-required"
        ? "upgrade-required"
        : "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

function connect(backup?: HistoryBackup) {
  if (!database) {
    database = openBrowserArticleDatabase(DB_NAME, backup, () => {
      useHistoryStorageState.setState({
        status: "error",
        message:
          "数据库已被其他版本接管，写入已停止。请先下载当前正文，再重新打开兼容版本。",
      });
    })
      .then((db) => {
        useHistoryStorageState.setState({ status: "ready", message: "" });
        return db;
      })
      .catch((error) => {
        database = null;
        reportInitializationError(error);
        if (backup)
          useHistoryStorageState.setState({ status: "upgrade-required" });
        throw error;
      });
  }
  return database;
}

export async function prepareHistoryUpgrade() {
  return readHistoryBackup(DB_NAME);
}

export async function upgradeHistoryDatabase(backup: HistoryBackup) {
  await connect(backup);
}

export async function loadHistoryFromDb() {
  const db = await connect();
  const rows = await db.list();
  snapshots.clear();
  for (const row of rows) snapshots.set(row.article.id, row);
  return rows
    .map((row) => row.article)
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

async function writableDatabase() {
  if (useHistoryStorageState.getState().status !== "ready")
    throw new ArticleStorageError(
      "unsupported",
      "文章存储尚未就绪，请先完成备份升级或处理读取错误",
    );
  return connect();
}

export async function addHistoryToDb(
  snapshot: HistorySnapshot,
  assets: ArticleAsset[] = [],
) {
  const db = await writableDatabase();
  const saved = await db
    .article(snapshot.id)
    .commit({ article: snapshot, assets }, null);
  snapshots.set(snapshot.id, saved);
}

export async function updateHistoryInDb(entry: HistorySnapshot) {
  const previous = snapshots.get(entry.id);
  if (!previous)
    throw new ArticleStorageError(
      "conflict",
      "文章尚未读取或已被删除，未保存任何更改",
    );
  const db = await writableDatabase();
  const saved = await db
    .article(entry.id)
    .commit({ article: entry, assets: previous.assets }, previous.revision);
  snapshots.set(entry.id, saved);
}

export async function deleteHistoryFromDb(id: string) {
  const previous = snapshots.get(id);
  if (!previous)
    throw new ArticleStorageError("conflict", "文章尚未读取或已被删除");
  const db = await writableDatabase();
  await db.remove(new Map([[id, previous.revision]]));
  snapshots.delete(id);
}

export async function clearHistoryDb() {
  const expected = new Map(
    [...snapshots].map(([id, row]) => [id, row.revision]),
  );
  const db = await writableDatabase();
  await db.remove(expected, true);
  snapshots.clear();
}

export async function prepareHistoryRestore(backup: HistoryBackup) {
  const db = await writableDatabase();
  const rows = await db.list();
  return {
    backup: structuredClone(backup),
    expected: new Map(rows.map((row) => [row.article.id, row.revision])),
    conflicts: rows
      .filter((row) =>
        backup.records.some((record) => record.key === row.article.id),
      )
      .map((row) => ({ id: row.article.id, title: row.article.title })),
  };
}
export async function mergeHistoryBackup(
  plan: Awaited<ReturnType<typeof prepareHistoryRestore>>,
) {
  const db = await writableDatabase();
  const result = await db.mergeBackup(plan.backup, plan.expected);
  for (const row of plan.backup.records)
    if (!plan.expected.has(row.key))
      snapshots.set(row.key, {
        article: normalizeLegacyArticle(row.value),
        revision: 0,
        assets: [],
      });
  return result;
}
