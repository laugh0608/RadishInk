// Fixed production builds only; no Vite modules, HMR, unregister or clear-site-data.
// Start pwa-upgrade-server.mjs; run with Playwright CLI run-code --filename.
// Directory checks use native OPFS with an explicit picker/permission substitute.
// prettier-ignore
async (page) => {
  const origin = "http://127.0.0.1:4183";
  const checks = [], errors = [];
  const context = await page.context().browser().newContext({ acceptDownloads: true });
  context.setDefaultTimeout(20_000);
  let target = await context.newPage();
  let step = "legacy";
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const select = async version => {
    const result = await context.request.post(`${origin}/__test/select?version=${version}`);
    ensure(result.ok(), "fixture switch failed");
  };
  const monitor = p => p.on("pageerror", error => errors.push(error.message));
  const ready = async () => {
    await target.locator(".cm-content").waitFor();
    await target.waitForFunction(() => !document.body.textContent.includes("正在加载文章"));
  };
  const menu = async name => {
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.getByRole("menuitem", { name, exact: true }).click();
  };
  const pasteImage = async () => {
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#429a63"; ctx.fillRect(0, 0, 2, 2);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], "合成图片.png", { type: "image/png" }));
      document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
    });
  };
  const imageReady = async () => target.waitForFunction(() => {
    const image = document.querySelector('.preview-content img[src^="blob:"]');
    return image?.complete && image.naturalWidth === 2;
  });
  const inspect = () => target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("wemd-history"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = store => new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const history = await read("history"), assets = await read("articleAssets"); db.close();
    return { history, assets: await Promise.all(assets.map(async a => ({ articleId: a.articleId, path: a.path, bytes: [...new Uint8Array(await a.bytes.arrayBuffer())] }))) };
  });
  const installUpdate = async version => {
    await select(version);
    await target.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await target.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
  };
  const update = () => target.getByRole("button", { name: "保存并更新", exact: true }).click();
  try {
    monitor(target); await select("legacy"); await target.goto(origin); await ready();
    await target.evaluate(async () => { await navigator.serviceWorker.ready; });
    await target.reload(); await ready();
    await target.waitForFunction(() => !!navigator.serviceWorker.controller);
    const choosing = target.waitForEvent("filechooser");
    await menu("导入 Markdown 为新文章…");
    await (await choosing).setFiles({ name: "升级合成.md", mimeType: "text/markdown", buffer: Buffer.from("---\ncustomFlag: pwa-preserved\ntitle: 升级合成\ntheme: default\n---\n# 升级合成正文\n") });
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await pasteImage(); await imageReady();
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const legacyAssets = (await inspect()).assets;
    ensure(legacyAssets.length === 1, "legacy asset missing");
    await installUpdate("new");
    step = "legacy final save";
    ensure(await target.locator(".pwa-update-notice").count() === 0, "legacy unexpectedly has new UI");
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.locator(".cm-content").pressSequentially(" legacy-latest-before-close");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.waitForFunction(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open("wemd-history"); r.onsuccess = () => resolve(r.result); });
      const rows = await new Promise(resolve => { const r = db.transaction("history").objectStore("history").getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
      return rows.some(r => r.markdown.includes("legacy-latest-before-close"));
    });
    step = "legacy natural activation";
    const installed = context.serviceWorkers().at(-1);
    await installed.evaluate(() => {
      self.__pwaActivationObserved = false;
      self.addEventListener("activate", () => { self.__pwaActivationObserved = true; }, { once: true });
    });
    await target.close();
    await installed.evaluate(async () => {
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        if (self.__pwaActivationObserved && self.registration.active?.state === "activated") return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("last window closed but worker remained waiting");
    });
    target = await context.newPage(); monitor(target); await target.goto(origin); await ready();
    step = "legacy new entry";
    await target.waitForFunction(() => document.documentElement.dataset.pwaFixture === "new");
    step = "legacy image restore";
    await imageReady();
    ensure((await target.locator(".cm-content").innerText()).includes("legacy-latest-before-close"), "legacy text lost");
    ensure(JSON.stringify((await inspect()).assets) === JSON.stringify(legacyAssets), "legacy assets changed");
    checks.push("81c01e5 历史构建 → 保存并关闭所有页面 → 新版：正文、未知元数据、资源原字节保留，无清库或注销 Worker");

    step = "safe browser update";
    const other = await context.newPage(); await other.goto(origin); await other.locator(".cm-content").waitFor();
    await other.locator(".cm-content").press("ControlOrMeta+End"); await other.locator(".cm-content").pressSequentially(" second-tab-unsaved");
    await installUpdate("next");
    await target.getByText("新版本已准备好", { exact: true }).waitFor();
    await target.getByRole("button", { name: "稍后", exact: true }).click();
    ensure(await target.evaluate(() => document.documentElement.dataset.pwaFixture) === "new", "later activated update");
    await target.getByRole("button", { name: "有新版本，查看更新", exact: true }).click();
    await update(); await target.getByRole("alert").filter({ hasText: "关闭其他" }).waitFor();
    ensure((await other.locator(".cm-content").innerText()).includes("second-tab-unsaved"), "other tab lost text");
    // Discard only this synthetic second-tab edit; it must not modify the first tab's article revision.
    await other.close();
    checks.push("稍后更新不激活；同作用域另一标签页存在时阻止更新，另一页未保存输入保留");

    step = "image operation";
    await target.evaluate(() => {
      const original = window.createImageBitmap;
      window.createImageBitmap = (...args) => new Promise((resolve, reject) => {
        window.__releaseImage = () => original(...args).then(resolve, reject);
      });
      window.__restoreImage = () => { window.createImageBitmap = original; };
    });
    await pasteImage(); await target.waitForFunction(() => !!window.__releaseImage);
    await update(); await target.getByRole("alert").filter({ hasText: "图片或文件操作尚未结束" }).waitFor();
    await target.evaluate(() => { window.__restoreImage(); window.__releaseImage(); });
    await target.waitForFunction(() => (document.querySelector(".cm-content")?.textContent.match(/asset\/image-/g) || []).length === 2);
    checks.push("真实图片解码被测试门闩延迟时阻止激活；释放后插入与资源保存完成");

    step = "ZIP operation";
    await target.evaluate(() => {
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (...args) { window.__releaseZip = () => original.apply(this, args); };
      window.__restoreZip = () => { Worker.prototype.postMessage = original; };
    });
    await menu("导出当前文章包（.zip）");
    await target.waitForFunction(() => !!window.__releaseZip);
    await update(); await target.getByRole("alert").filter({ hasText: "图片或文件操作尚未结束" }).waitFor();
    await target.getByRole("button", { name: "取消文章包处理", exact: true }).click();
    await target.getByText(/文章包未导出/).waitFor();
    await target.evaluate(() => window.__restoreZip());
    checks.push("真实 ZIP Worker 启动后被测试门闩延迟时阻止更新；产品取消后恢复可用");

    step = "failed persistence";
    await target.locator(".cm-content").press("ControlOrMeta+End"); await target.locator(".cm-content").pressSequentially(" browser-latest-unsaved");
    await target.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name === "wemd-history" && mode === "readwrite") throw new DOMException("synthetic quota failure", "QuotaExceededError");
        return original.call(this, stores, mode, ...rest);
      };
      window.__restoreTransactions = () => { IDBDatabase.prototype.transaction = original; };
    });
    await update(); await target.getByRole("complementary", { name: "应用更新" }).getByRole("alert").filter({ hasText: "synthetic quota failure" }).waitFor();
    ensure(await target.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), "save failure activated worker");
    ensure((await target.locator(".cm-content").innerText()).includes("browser-latest-unsaved"), "save failure lost text");
    ensure(await target.locator(".pwa-app-content").evaluate(el => !el.inert), "failure left editor inert");
    await target.screenshot({ path: "output/playwright/pwa-save-failure.png" });
    await target.evaluate(() => window.__restoreTransactions());
    const assetsBeforeUpdate = (await inspect()).assets;
    await context.setOffline(true);
    await update();
    await target.waitForFunction(() => document.documentElement.dataset.pwaFixture === "next"); await ready(); await imageReady();
    const after = await inspect();
    ensure(after.history.some(r => r.markdown.includes("browser-latest-unsaved") && r.markdown.includes("customFlag: pwa-preserved")), "newest body or metadata lost");
    ensure(JSON.stringify(after.assets) === JSON.stringify(assetsBeforeUpdate), "image bytes changed on upgrade");
    await context.setOffline(false);
    checks.push("注入配额拒写：不激活、不刷新且可继续编辑；恢复后离线完成保存、接管与重载，最新正文和全部图片字节一致");
    await target.screenshot({ path: "output/playwright/pwa-updated.png" });
    ensure(errors.length === 0, errors.join(" | "));
    return { checks, errors, browser: await context.browser().version(), assets: after.assets.map(a => ({ path: a.path, bytes: a.bytes.length })) };
  } catch (error) {
    await target.screenshot({ path: "output/playwright/pwa-upgrade-failure.png" });
    const state = await target.evaluate(async () => ({ marker: document.documentElement.dataset.pwaFixture, controller: !!navigator.serviceWorker.controller, waiting: (await navigator.serviceWorker.getRegistration())?.waiting?.state }));
    throw new Error(step + ": " + error.message + "\n" + JSON.stringify(state) + "\n" + (await target.locator("body").innerText()).slice(-2200));
  } finally { await context.close(); }
}
