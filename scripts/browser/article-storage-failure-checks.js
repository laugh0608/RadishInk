// 全新上下文中的合成故障检查；不访问已有用户浏览器配置。
// prettier-ignore
async (page) => {
  const origin = new URL(page.url()).origin;
  const checks = [];
  const create = async (version) => {
    const context = await page.context().browser().newContext({ acceptDownloads: true });
    const target = await context.newPage();
    await target.route(origin + "/", route => route.fulfill({ contentType: "text/html", body: "Synthetic fault setup" }));
    await target.goto(origin);
    await target.evaluate(async version => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("wemd-history", version);
        req.onupgradeneeded = () => req.result.createObjectStore("history"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      const tx = db.transaction("history", "readwrite");
      tx.objectStore("history").put({ id: "synthetic", title: "故障合成文章", markdown: "# 原文\n", createdAt: "2026-10-14T00:00:00.000Z", savedAt: "2026-10-14T00:00:00.000Z", theme: "default", themeName: "默认主题", customCSS: "" }, "synthetic");
      await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    }, version);
    await target.unroute(origin + "/");
    return { context, target };
  };
  const exportBackup = async target => {
    await target.getByRole("dialog", { name: "备份并升级浏览器文章" }).waitFor();
    await target.locator("body").ariaSnapshot();
    const downloaded = target.waitForEvent("download");
    await target.getByRole("button", { name: "下载升级前备份" }).click(); await downloaded;
    await target.getByRole("checkbox").check();
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const { context, target } = await create(2);
  try {
    const blocker = await context.newPage();
    await blocker.route(origin + "/", route => route.fulfill({ contentType: "text/html", body: "Synthetic v2 blocker" }));
    await blocker.goto(origin);
    await blocker.evaluate(async () => { window.syntheticDb = await new Promise(resolve => { const r = indexedDB.open("wemd-history", 2); r.onsuccess = () => resolve(r.result); }); });
    await target.reload(); await exportBackup(target);
    await target.getByRole("button", { name: "确认升级", exact: true }).click();
    await target.getByText("旧标签页占用数据库，请关闭后重新发起升级", { exact: true }).waitFor();
    await blocker.close();
    const version = await target.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open("wemd-history"); r.onsuccess = () => resolve(r.result); }); const v = db.version; db.close(); return v; });
    check(version === 2, "被占用的升级在关闭标签后偷偷执行");
    checks.push("占用失败后取消升级请求，关闭旧标签不会迟到升级");
    await exportBackup(target);
    await target.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open("wemd-history", 2); r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction("history", "readwrite"); const req = tx.objectStore("history").get("synthetic"); req.onsuccess = () => tx.objectStore("history").put({ ...req.result, markdown: "# 备份后旧版编辑\n" }, "synthetic");
      await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    });
    await target.getByRole("button", { name: "确认升级", exact: true }).click();
    await target.getByText("备份后文章发生变化，升级已中止，请重新备份", { exact: true }).waitFor();
    await exportBackup(target); await target.getByRole("button", { name: "确认升级", exact: true }).click();
    await target.locator(".cm-content").waitFor();
    check((await target.locator(".cm-content").innerText()).includes("备份后旧版编辑"), "重试未使用最新备份");
    checks.push("过期备份中止并保留 v2；重新备份后成功升级最新旧文");
    await target.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      window.syntheticOriginalPut = original;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "history") throw new DOMException("synthetic quota", "QuotaExceededError");
        return original.apply(this, args);
      };
    });
    await target.locator(".cm-content").fill("# 配额失败的待保存正文\n"); await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByRole("dialog", { name: "浏览器文章暂不可用" }).waitFor();
    check((await target.locator(".cm-content").innerText()).includes("配额失败的待保存正文"), "失败丢失编辑");
    check(await target.getByText("已保存", { exact: true }).count() === 0, "配额失败仍提示已保存");
    check((await target.locator(".save-indicator").innerText()) === "未保存", "状态栏伪造保存成功");
    const content = await target.evaluate(async () => {
      IDBObjectStore.prototype.put = window.syntheticOriginalPut;
      const { openBrowserArticleDatabase } = await import("/src/storage/articles/browserArticleDatabase.ts");
      const db = await openBrowserArticleDatabase("wemd-history"); try { return (await db.article("synthetic").read()).article.markdown; } finally { db.close(); }
    });
    check(content === "# 备份后旧版编辑\n", "配额失败改变已存原文");
    await target.getByRole("button", { name: "稍后处理" }).click(); await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.waitForFunction(async () => (await import("/src/store/historyStore.ts")).useHistoryStore.getState().history[0].markdown.includes("配额失败的待保存正文"));
    checks.push("真实事务注入配额异常：原文不变、编辑保留、无成功假象，重试成功");
  } catch (error) { throw new Error(String(error) + "\n" + await target.locator("body").innerText()); } finally { await context.close(); }
  const future = await create(4);
  try {
    await future.target.reload(); await future.target.getByRole("dialog", { name: "浏览器文章暂不可用" }).waitFor();
    check((await future.target.locator("body").innerText()).includes("不支持数据库版本 4"), "没有不兼容版本提示");
    check(await future.target.locator(".cm-content").count() === 0, "不兼容库仍开放写入");
    checks.push("未来 v4 拒绝读写并显示兼容提示，不降级/清库");
  } finally { await future.context.close(); }
  return { checks };
}
