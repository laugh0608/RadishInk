import { assertPrototypeName, ArticleStorageError } from "./articleContract";
import {
  openBrowserArticleDatabase,
  readHistoryBackup as readBackup,
  validateBackup,
  type HistoryBackup,
} from "./browserArticleDatabase";
export type { HistoryBackup } from "./browserArticleDatabase";

export async function readHistoryBackup(databaseName: string) {
  assertPrototypeName(databaseName);
  return readBackup(databaseName);
}

export async function openBrowserArticlePrototype(
  databaseName: string,
  backup: HistoryBackup,
) {
  assertPrototypeName(databaseName);
  return openBrowserArticleDatabase(databaseName, backup);
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
