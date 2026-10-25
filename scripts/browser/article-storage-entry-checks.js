// Playwright CLI run-code --filename；每次运行新建隔离上下文，所有文章均为合成数据。
// prettier-ignore
async (page) => {
  // 当前 CLI 的 waitForFunction 不等待 async 谓词；evaluate 显式 await 后轮询，失败仍超时抛错。
  const waitForAsync = async (targetPage, predicate, arg = null, options = {}) => {
    const deadline = Date.now() + (options.timeout || 30000);
    while (Date.now() < deadline) {
      if (await targetPage.evaluate(predicate, arg)) return;
      await targetPage.waitForTimeout(50);
    }
    throw new Error("异步状态等待超时：" + predicate.toString());
  };

  const context = await page.context().browser().newContext({ acceptDownloads: true });
  const checks = [];
  const failures = [];
  const origin = new URL(page.url()).origin;
  const isolated = await context.newPage();
  isolated.on("pageerror", error => failures.push(error.message));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    await isolated.route(origin + "/", route => route.fulfill({ contentType: "text/html", body: "Synthetic storage setup" }));
    await isolated.goto(origin);
    await isolated.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("wemd-history", 2);
        request.onupgradeneeded = () => request.result.createObjectStore("history");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("history", "readwrite");
      for (let i = 0; i < 31; i++) {
        const id = `synthetic-${String(i).padStart(2, "0")}`;
        tx.objectStore("history").put({ id, title: `合成文章 ${i}`, markdown: "\uFEFF---\r\ncustomFlag: keep\r\n---\r\n\r\n# 合成正文 " + i + "\r\n", theme: "default", themeName: "默认主题", customCSS: "", createdAt: "2026-10-14T00:00:00.000Z", savedAt: "2026-10-14T01:00:00.000Z", extra: { keep: i } }, id);
      }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    });
    await isolated.unroute(origin + "/"); await isolated.reload();
    await isolated.getByRole("dialog", { name: "备份并升级浏览器文章" }).waitFor();
    const preUpgrade = await isolated.locator("body").ariaSnapshot();
    check(preUpgrade.includes("下载升级前备份"), "没有备份入口");
    check(await isolated.getByRole("button", { name: "确认升级", exact: true }).isDisabled(), "未下载即可升级");
    check(await isolated.locator(".cm-content").count() === 0, "升级前可编辑造成丢失风险");
    await isolated.screenshot({ path: "output/playwright/p2a-upgrade-entry.png", fullPage: true, animations: "disabled" });
    const downloadEvent = isolated.waitForEvent("download");
    await isolated.getByRole("button", { name: "下载升级前备份" }).click();
    const download = await downloadEvent; await download.saveAs("output/playwright/p2a-synthetic-v2-backup.json");
    const before = await isolated.evaluate(async () => {
      const { prepareHistoryUpgrade } = await import("/src/store/historyDb.ts");
      const backup = await prepareHistoryUpgrade();
      return { count: backup.records.length, source: backup.records[0].value.markdown, extra: backup.records[0].value.extra };
    });
    check(before.count === 31 && before.source.startsWith("\uFEFF") && before.extra.keep === 0, "备份损失旧文");
    check(await isolated.getByRole("button", { name: "确认升级", exact: true }).isDisabled(), "缺少用户确认");
    await isolated.getByRole("checkbox").check();
    await isolated.getByRole("button", { name: "确认升级", exact: true }).click();
    await isolated.getByRole("heading", { name: "文章 31 / 30", exact: true }).waitFor();
    await isolated.locator(".cm-content").waitFor();
    check(await isolated.getByRole("button", { name: "新建文章", exact: true }).isDisabled(), "超过上限仍可新建");
    checks.push("v2 升级需下载及确认；31 篇、BOM/CRLF、未知字段完整保留；超限不裁剪");
    const identity = await isolated.evaluate(async () => {
      const { useHistoryStore } = await import("/src/store/historyStore.ts");
      const state = useHistoryStore.getState(); return { id: state.activeId, markdown: state.history.find(row => row.id === state.activeId).markdown };
    });
    check(identity.markdown === before.source, "升级改变源文");
    const editor = isolated.locator(".cm-content");
    await editor.fill("# 快捷键保存合成正文\n");
    await editor.press("ControlOrMeta+s");
    await waitForAsync(isolated, async () => {
      const { useHistoryStore } = await import("/src/store/historyStore.ts");
      const state = useHistoryStore.getState(); return state.history.find(row => row.id === state.activeId)?.markdown.includes("快捷键保存合成正文");
    });
    await isolated.reload(); await isolated.locator(".cm-content").waitFor();
    check((await isolated.locator(".cm-content").innerText()).includes("快捷键保存合成正文"), "刷新未恢复最新保存");
    checks.push("实际编辑器 Ctrl/Meta+S 写入并刷新恢复");
    await isolated.locator(".cm-content").fill("# 自动保存合成正文\n");
    await waitForAsync(isolated, async () => {
      const { useHistoryStore } = await import("/src/store/historyStore.ts");
      const state = useHistoryStore.getState(); return state.history.find(row => row.id === state.activeId)?.markdown.includes("自动保存合成正文");
    }, null, { timeout: 15000 });
    checks.push("10 秒自动保存写入实际文章库");
    const second = await context.newPage(); await second.goto(origin); await second.locator(".cm-content").waitFor();
    await isolated.locator(".cm-content").fill("# 第一标签获胜\n"); await isolated.locator(".cm-content").press("ControlOrMeta+s");
    await waitForAsync(isolated, async () => (await import("/src/store/historyStore.ts")).useHistoryStore.getState().history.some(row => row.markdown.includes("第一标签获胜")));
    await second.locator(".cm-content").fill("# 第二标签未保存编辑\n"); await second.locator(".cm-content").press("ControlOrMeta+s");
    await second.getByRole("dialog", { name: "浏览器文章暂不可用" }).waitFor();
    check((await second.locator(".cm-content").innerText()).includes("第二标签未保存编辑"), "冲突覆盖当前编辑");
    const saved = await isolated.evaluate(async id => {
      const { openBrowserArticleDatabase } = await import("/src/storage/articles/browserArticleDatabase.ts");
      const db = await openBrowserArticleDatabase("wemd-history");
      try { return await db.article(id).read(); } finally { db.close(); }
    }, identity.id);
    check(saved.article.markdown.includes("第一标签获胜") && saved.article.markdown.includes("customFlag: keep"), "冲突覆盖数据库或丢失元数据");
    await second.screenshot({ path: "output/playwright/p2a-conflict-preserved.png", fullPage: true, animations: "disabled" });
    await second.close();
    checks.push("两个真实标签页 CAS 冲突：数据库保持胜者、败者编辑及未知元数据保留");
    // 使用真实存储事务验证资源随改名保留、删除/清空校验；不开放尚未实现的图片 UI。
    const lifecycle = await isolated.evaluate(async () => {
      const { openBrowserArticleDatabase } = await import("/src/storage/articles/browserArticleDatabase.ts");
      const { useHistoryStore } = await import("/src/store/historyStore.ts");
      const db = await openBrowserArticleDatabase("wemd-history");
      try {
        const state = useHistoryStore.getState(); const rows = await db.list(); const row = rows.find(row => row.article.id === state.activeId);
        await db.article(row.article.id).commit({ article: row.article, assets: [{ path: "asset/synthetic.png", bytes: new Blob([new Uint8Array([0, 1, 2, 255])], { type: "image/png" }) }] }, row.revision);
        let rejected = false;
        try { await state.deleteEntry(row.article.id); } catch { rejected = true; }
        if (!rejected || !(await db.article(row.article.id).read())) throw new Error("旧版本删除未被拒绝");
        const expected = new Map(rows.map(row => [row.article.id, row.revision]));
        try { await db.remove(expected, true); throw new Error("清空应冲突"); } catch (error) { if (error.code !== "conflict") throw error; }
        if ((await db.list()).length !== 31) throw new Error("清空冲突未原子回滚");
        return true;
      } finally { db.close(); }
    });
    check(lifecycle, "生命周期检查失败");
    await isolated.reload(); await isolated.locator(".cm-content").waitFor();
    await isolated.getByRole("button", { name: "操作菜单" }).first().click();
    await isolated.getByRole("button", { name: "重命名", exact: true }).click();
    await isolated.locator(".history-rename input").fill("资源文章改名");
    await isolated.getByRole("button", { name: "确认", exact: true }).click();
    const renamed = await isolated.evaluate(async id => {
      const { openBrowserArticleDatabase } = await import("/src/storage/articles/browserArticleDatabase.ts");
      const db = await openBrowserArticleDatabase("wemd-history");
      try { const row = await db.article(id).read(); return { title: row.article.title, bytes: Array.from(new Uint8Array(await row.assets[0].bytes.arrayBuffer())) }; } finally { db.close(); }
    }, identity.id);
    check(renamed.title === "资源文章改名" && renamed.bytes.join() === "0,1,2,255", "改名丢失资源");
    await isolated.getByRole("button", { name: "操作菜单" }).first().click();
    await isolated.getByRole("button", { name: "删除", exact: true }).click();
    await isolated.getByRole("button", { name: "确认删除", exact: true }).click();
    await isolated.getByRole("heading", { name: "文章 30 / 30", exact: true }).waitFor();
    const deleted = await isolated.evaluate(async id => {
      const db = await new Promise(resolve => { const request = indexedDB.open("wemd-history"); request.onsuccess = () => resolve(request.result); });
      const tx = db.transaction(["history", "articleAssets", "articleRevisions"]);
      const requests = [tx.objectStore("history").get(id), tx.objectStore("articleRevisions").get(id), tx.objectStore("articleAssets").index("articleId").getAll(id)];
      const values = await Promise.all(requests.map(request => new Promise(resolve => { request.onsuccess = () => resolve(request.result); }))); db.close();
      return values[0] === undefined && values[1] === undefined && values[2].length === 0;
    }, identity.id);
    check(deleted, "删除留下文章资源或版本");
    checks.push("改名保留二进制字节；陈旧删除/清空拒绝且原子回滚；UI 删除正文/资源/版本一致");
    check(failures.length === 0, "浏览器异常：" + failures.join("; "));
    return { checks, pageErrors: failures, screenshots: ["output/playwright/p2a-upgrade-entry.png", "output/playwright/p2a-conflict-preserved.png"] };
  } finally { await context.close(); }
}
