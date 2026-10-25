// 由 scripts/browser/article-prototype-checks.js 通过 Playwright CLI 在临时浏览器调用。
// 不被产品入口导入；真实 IndexedDB / OPFS 验证与 Vitest 故障替身证据分开记录。
import { deleteDB, openDB } from "idb";
import {
  openBrowserArticlePrototype,
  readHistoryBackup,
  restoreHistoryBackup,
} from "../../storage/articles/browserArticlePrototype";
import { DirectoryArticlePrototype } from "../../storage/articles/directoryArticlePrototype";
import { digest } from "../../storage/articles/articleContract";
import {
  optionalFile,
  readText,
  writeFile,
} from "../../storage/articles/directoryArticleIO";
import { syntheticArticle } from "./articlePrototypeFixtures";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    check(
      (error as { code?: string; name?: string }).code === code ||
        (error as Error).name === code,
      `错误分类不符，预期 ${code}，实际 ${String(error)}`,
    );
    return;
  }
  throw new Error(`应拒绝：${code}`);
}

function interruptMarkdownClose(root: FileSystemDirectoryHandle) {
  // 保留原生句柄与原生暂存流，只在目标正文 close 前注入一次失败。
  let interrupted = false;
  const wrapDirectory = (
    directory: FileSystemDirectoryHandle,
  ): FileSystemDirectoryHandle =>
    new Proxy(directory, {
      get(target, property) {
        if (property === "getDirectoryHandle")
          return async (
            name: string,
            options?: FileSystemGetDirectoryHandleOptions,
          ) => wrapDirectory(await target.getDirectoryHandle(name, options));
        if (property === "getFileHandle")
          return async (
            name: string,
            options?: FileSystemGetFileHandleOptions,
          ) => {
            const file = await target.getFileHandle(name, options);
            if (name !== "index.md") return file;
            return new Proxy(file, {
              get(target, property) {
                if (property === "createWritable")
                  return async () => {
                    const stream = await target.createWritable();
                    return {
                      write: (value: string | Blob) => stream.write(value),
                      abort: () => stream.abort(),
                      close: () => {
                        if (!interrupted) {
                          interrupted = true;
                          throw new DOMException(
                            "合成关闭中断",
                            "QuotaExceededError",
                          );
                        }
                        return stream.close();
                      },
                    };
                  };
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return wrapDirectory(root);
}

export async function runNativeArticlePrototypeChecks() {
  const checks: string[] = [];
  const databases: string[] = [];
  const connections: { close(): void }[] = [];
  const prefix = `radishink-p2a-prototype-${crypto.randomUUID()}`;
  let opfs: FileSystemDirectoryHandle | undefined;
  const seed = async (suffix: string, count = 1) => {
    const name = `${prefix}-${suffix}`;
    databases.push(name);
    const db = await openDB(name, 2, {
      upgrade(db) {
        db.createObjectStore("history");
      },
    });
    const tx = db.transaction("history", "readwrite");
    for (let index = 0; index < count; index++) {
      const row = syntheticArticle(`article-${index}`);
      await tx.store.put({ ...row, syntheticUnknown: "必须保留" }, row.id);
    }
    await tx.done;
    db.close();
    return name;
  };
  try {
    const name = await seed("history");
    const backup = await readHistoryBackup(name);
    const prototype = await openBrowserArticlePrototype(name, backup);
    connections.push(prototype);
    const store = prototype.article("article-0");
    const migrated = (await store.read())!;
    check(
      JSON.stringify(migrated.article) ===
        JSON.stringify(backup.records[0].value),
      "迁移改写了旧文章或未知字段",
    );
    check(
      migrated.revision === 0 && migrated.assets.length === 0,
      "迁移后的初始资源状态错误",
    );
    await rejects(() => openDB(name, 2), "VersionError");
    checks.push("v2→v3 保留 ID、正文、BOM、CRLF、未知元数据；旧版连接拒绝写入");

    const bytes = new Blob([new Uint8Array([0, 255, 17, 42, 128])], {
      type: "application/octet-stream",
    });
    const next = {
      article: {
        ...syntheticArticle("article-0"),
        markdown: `${migrated.article.markdown}\r\n![合成](asset/binary.bin)`,
      },
      assets: [{ path: "asset/binary.bin", bytes }],
    };
    await store.commit(next, 0);
    prototype.close();
    const reopened = await openBrowserArticlePrototype(name, backup);
    connections.push(reopened);
    const saved = (await reopened.article("article-0").read())!;
    check(
      saved.article.markdown === next.article.markdown && saved.revision === 1,
      "重开丢失正文",
    );
    check(
      "syntheticUnknown" in saved.article &&
        saved.article.syntheticUnknown === "必须保留",
      "后续保存抹掉旧记录的未知字段",
    );
    check(
      (await digest(saved.assets[0].bytes)) === (await digest(bytes)),
      "重开丢失 Blob 字节",
    );
    await rejects(
      () => reopened.article("other").commit(next, null),
      "invalid",
    );
    checks.push(
      "原生 IndexedDB 原子保存并重开，Blob 逐字节一致、跨文章提交拒绝",
    );

    const competitor = await openBrowserArticlePrototype(name, backup);
    connections.push(competitor);
    const race = await Promise.allSettled([
      reopened
        .article("article-0")
        .commit({ ...next, article: { ...next.article, title: "合成 A" } }, 1),
      competitor
        .article("article-0")
        .commit({ ...next, article: { ...next.article, title: "合成 B" } }, 1),
    ]);
    check(
      race.filter((result) => result.status === "fulfilled").length === 1,
      "并发覆盖未阻止",
    );
    check(
      race.filter((result) => result.status === "rejected").length === 1,
      "并发失败未报告",
    );
    checks.push("两个原生连接同版本并发保存：一成功、一冲突");

    const beforeAbort = (await reopened.article("article-0").read())!;
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === "articleAssets")
          throw new DOMException("合成配额失败", "QuotaExceededError");
        return originalPut.call(this, value, key);
      };
      await rejects(
        () =>
          reopened.article("article-0").commit(
            {
              ...beforeAbort,
              article: { ...beforeAbort.article, markdown: "不应提交的正文" },
            },
            beforeAbort.revision,
          ),
        "QuotaExceededError",
      );
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const afterAbort = (await reopened.article("article-0").read())!;
    check(
      afterAbort.article.markdown === beforeAbort.article.markdown &&
        afterAbort.revision === beforeAbort.revision,
      "事务失败仍保存了正文或版本",
    );
    check(
      (await digest(afterAbort.assets[0].bytes)) === (await digest(bytes)),
      "事务失败破坏旧资源",
    );
    checks.push("资源写入注入配额错误，真实事务回滚正文、资源与版本");

    const staleName = await seed("stale");
    const staleBackup = await readHistoryBackup(staleName);
    const legacy = await openDB(staleName, 2);
    const changed = {
      ...staleBackup.records[0].value,
      markdown: "备份后合成编辑",
    };
    await legacy.put("history", changed, changed.id);
    legacy.close();
    await rejects(
      () => openBrowserArticlePrototype(staleName, staleBackup),
      "conflict",
    );
    const rolledBack = await openDB(staleName);
    check(
      rolledBack.version === 2 &&
        !rolledBack.objectStoreNames.contains("articleAssets"),
      "升级中止没有回滚 schema",
    );
    check(
      (await rolledBack.get("history", changed.id)).markdown ===
        changed.markdown,
      "升级中止损坏原文",
    );
    rolledBack.close();
    const freshBackup = await readHistoryBackup(staleName);
    const retried = await openBrowserArticlePrototype(staleName, freshBackup);
    connections.push(retried);
    check(
      (await retried.article(changed.id).read())!.article.markdown ===
        changed.markdown,
      "升级重试失败",
    );
    checks.push(
      "备份过期触发升级中止：schema 回到 v2、原文保留，重新备份可重试",
    );

    const restoreName = `${prefix}-restored`;
    databases.push(restoreName);
    await restoreHistoryBackup(staleBackup, restoreName);
    const restored = await readHistoryBackup(restoreName);
    check(
      JSON.stringify(restored.records) === JSON.stringify(staleBackup.records),
      "备份恢复不一致",
    );
    await rejects(
      () => restoreHistoryBackup(staleBackup, restoreName),
      "conflict",
    );
    checks.push("升级前备份恢复到新 v2 库，不降级原库、不覆盖已有目标");

    const blockedName = await seed("blocked");
    const blockedBackup = await readHistoryBackup(blockedName);
    const blocker = await openDB(blockedName, 2);
    connections.push(blocker);
    await rejects(
      () => openBrowserArticlePrototype(blockedName, blockedBackup),
      "blocked",
    );
    blocker.close();
    // 此 open 在被拒绝的升级请求之后排队，证明旧请求没有迟到升级。
    const afterBlocked = await openDB(blockedName);
    check(afterBlocked.version === 2, "blocked 请求被拒绝后仍进行了迟到升级");
    afterBlocked.close();
    const unblocked = await openBrowserArticlePrototype(
      blockedName,
      blockedBackup,
    );
    connections.push(unblocked);
    checks.push("旧连接占用明确阻断；关闭后重新请求成功，无迟到升级");

    const malformedName = await seed("malformed");
    const malformed = await openDB(malformedName, 2);
    await malformed.put(
      "history",
      { ...syntheticArticle("article-0"), markdown: null },
      "article-0",
    );
    malformed.close();
    await rejects(() => readHistoryBackup(malformedName), "invalid");
    const malformedAfter = await openDB(malformedName);
    check(malformedAfter.version === 2, "不合法旧文触发了升级");
    malformedAfter.close();
    checks.push("不合法旧数据在备份阶段明确拒绝，不清库或生成空文章");

    const overLimitName = await seed("over-limit", 31);
    const overLimitBackup = await readHistoryBackup(overLimitName);
    const overLimit = await openBrowserArticlePrototype(
      overLimitName,
      overLimitBackup,
    );
    connections.push(overLimit);
    check(
      (await overLimit.article("article-30").read()) !== null,
      "迁移静默淘汰了超过上限的文章",
    );
    await rejects(
      () =>
        overLimit
          .article("new")
          .commit({ article: syntheticArticle("new"), assets: [] }, null),
      "capacity",
    );
    const oldest = (await overLimit.article("article-0").read())!;
    await overLimit
      .article("article-0")
      .commit(
        { ...oldest, article: { ...oldest.article, title: "仍可保存" } },
        0,
      );
    checks.push("31 篇旧文全部保留，禁止继续新建但允许已有文章保存");

    const newer = await openDB(name, 4);
    connections.push(newer);
    await rejects(
      () => reopened.article("article-0").commit(next, 2),
      "unsupported",
    );
    checks.push("versionchange 主动关闭连接，旧实例停止写入");

    opfs = await navigator.storage.getDirectory();
    const root = await opfs.getDirectoryHandle(prefix, { create: true });
    await writeFile(root, "旧文.md", syntheticArticle().markdown);
    const folderStore = new DirectoryArticlePrototype(
      root,
      "合成文章--a",
      "synthetic-a",
    );
    await folderStore.copyLegacy("旧文.md", syntheticArticle());
    const copied = (await folderStore.read())!;
    check(
      copied.article.markdown === syntheticArticle().markdown,
      "原生目录复制改变源文",
    );
    const withAsset = {
      ...copied,
      assets: [{ path: "asset/binary.bin", bytes }],
    };
    await folderStore.commit(withAsset, 0);
    const newInstance = new DirectoryArticlePrototype(
      root,
      "合成文章--a",
      "synthetic-a",
    );
    const directoryRead = (await newInstance.read())!;
    check(
      (await digest(directoryRead.assets[0].bytes)) === (await digest(bytes)),
      "目录重开资源不一致",
    );
    check(
      (await readText((await optionalFile(root, "旧文.md"))!)) ===
        syntheticArticle().markdown,
      "迁移修改了原文件",
    );
    checks.push(
      "原生 OPFS + Web Locks：旧文复制、空 asset/、二进制保存、重开，原件保留",
    );

    const interruptedStore = new DirectoryArticlePrototype(
      interruptMarkdownClose(root),
      "合成文章--a",
      "synthetic-a",
    );
    const interruptedContent = {
      ...directoryRead,
      article: {
        ...directoryRead.article,
        markdown: `${directoryRead.article.markdown}\r\n恢复后的合成内容`,
      },
    };
    await rejects(
      () => interruptedStore.commit(interruptedContent, directoryRead.revision),
      "QuotaExceededError",
    );
    await rejects(() => newInstance.read(), "recovery-required");
    const recovered = (await new DirectoryArticlePrototype(
      root,
      "合成文章--a",
      "synthetic-a",
    ).recover())!;
    check(
      recovered.article.markdown === interruptedContent.article.markdown &&
        recovered.revision === 2,
      "原生文件恢复失败",
    );
    check(
      (await digest(recovered.assets[0].bytes)) === (await digest(bytes)),
      "原生恢复损坏资源",
    );
    checks.push(
      "原生 OPFS 写入中断：重建实例后读取持久化日志并恢复，资源校验一致",
    );
    return { passed: checks.length, checks };
  } finally {
    for (const connection of connections) connection.close();
    for (const name of databases) await deleteDB(name);
    if (opfs) await opfs.removeEntry(prefix, { recursive: true });
  }
}
