// Playwright CLI run-code --filename；生产构建 + server-workspace-server.cjs。
// 所有账号 / 文章 / 图片都是合成数据，不读取开发者浏览器状态。
// prettier-ignore
async (page) => {
  const browser = page.context().browser(), origin = "http://127.0.0.1:4193";
  const checks = [], errors = [], contexts = [];
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const make = async () => { const context = await browser.newContext({ acceptDownloads: true, hasTouch: true }); contexts.push(context); return context; };
  const login = async (target, username = "alice") => {
    await target.getByRole("textbox", { name: "用户名", exact: true }).fill(username);
    await target.getByRole("textbox", { name: "密码", exact: true }).fill("synthetic-web-password");
    await target.getByRole("button", { name: "登录", exact: true }).click();
    await target.locator(".server-workspace-panel").waitFor({ state: "visible" });
  };
  const fileMenu = async (target, name) => {
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.getByRole("menuitem", { name, exact: true }).click();
  };
  let step = "static", target;
  try {
    const staticContext = await make(); target = await staticContext.newPage();
    const staticApi = [];
    target.on("request", request => { if (/\/api\//.test(request.url())) staticApi.push(request.url()); });
    await target.goto(origin + "/static/"); await target.locator(".cm-content").waitFor();
    await target.locator(".cm-content").fill("# static-synthetic\n浏览器正文");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    ensure(staticApi.length === 0, "静态模式意外探测 API");
    checks.push("静态默认配置：编辑和保存无 API 请求");
    await staticContext.close(); contexts.splice(contexts.indexOf(staticContext), 1);

    step = "login/create";
    const context = await make(); target = await context.newPage();
    target.on("pageerror", error => errors.push(error.message));
    const privateCacheHeaders = [];
    target.on("response", response => { if (response.url().includes("/api/v1/")) privateCacheHeaders.push(response.headers()["cache-control"]); });
    await target.goto(origin + "/nested/"); await login(target);
    const created = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 201);
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    const articleId = (await (await created).json()).articleId;
    await target.locator(".cm-content").filter({ hasText: "新文章" }).waitFor();
    const marker = "private-alice-" + Date.now();
    const saved = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 200);
    await target.locator(".cm-content").fill(`# ${marker}\n\n服务器合成正文`);
    await target.locator(".cm-content").press("ControlOrMeta+s"); await saved;
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    ensure(await target.getByRole("button", { name: "新建文件夹", exact: true }).count() === 0, "服务器误开放文件夹");
    checks.push("子路径同源部署：登录、新建、编辑保存，无文件夹操作");

    step = "image/zip";
    const png = await target.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 2; const ctx = c.getContext("2d"); ctx.fillStyle = "#ff6622"; ctx.fillRect(0, 0, 2, 2); return c.toDataURL("image/png").split(",")[1]; });
    const choosing = target.waitForEvent("filechooser");
    await target.getByRole("button", { name: "选择图片", exact: true }).click();
    await (await choosing).setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const zip = target.waitForEvent("download"); await fileMenu(target, "导出当前文章包（.zip）");
    await (await zip).saveAs("output/playwright/p3-server.zip");
    const importing = target.waitForEvent("filechooser"); await fileMenu(target, "导入文章包（.zip）…");
    const imported = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 201);
    await (await importing).setFiles("output/playwright/p3-server.zip");
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    const importedId = (await (await imported).json()).articleId;
    ensure(importedId && importedId !== articleId, "ZIP 未分配新身份");
    checks.push("真实图片选择、Blob 预览、生产 ZIP Worker 导出与新 ID 回导");

    step = "private storage";
    const leaked = await target.evaluate(async needle => {
      if (Object.keys(localStorage).some(key => String(localStorage.getItem(key)).includes(needle))) return "localStorage";
      const databases = await indexedDB.databases();
      for (const info of databases) {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(info.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { for (const name of db.objectStoreNames) {
          const records = await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
          if (JSON.stringify(records).includes(needle)) return `IndexedDB/${info.name}/${name}`;
        } } finally { db.close(); }
      }
      return null;
    }, marker);
    ensure(!leaked, "服务器正文泄漏到 " + leaked);
    checks.push("私有正文未进入 IndexedDB / localStorage");

    step = "conflict";
    // 通过当前文章保存响应取得准确身份，然后在独立 API 请求中模拟另一编辑端。
    const editResponse = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 200);
    await target.locator(".cm-content").press("ControlOrMeta+End"); await target.locator(".cm-content").press("Enter"); await target.locator(".cm-content").pressSequentially("before-conflict");
    await target.locator(".cm-content").press("ControlOrMeta+s"); const activeId = (await (await editResponse).json()).articleId;
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const conflictResult = await target.evaluate(async id => {
      const session = await (await fetch("/nested/api/v1/auth/session", { cache: "no-store" })).json();
      const article = await (await fetch(`/nested/api/v1/articles/${id}`, { cache: "no-store" })).json();
      const body = new FormData(); body.append("manifest", JSON.stringify({ operationId: crypto.randomUUID(), expectedRevision: article.revision, metadata: article.metadata, assets: article.assets })); body.append("markdown", new Blob([article.markdown + "\nREMOTE EDIT"]), "index.md");
      return (await fetch(`/nested/api/v1/articles/${id}`, { method: "PUT", headers: { "X-CSRF-Token": session.csrfToken }, body })).status;
    }, activeId);
    ensure(conflictResult === 200, "未能建立远端冲突");
    await target.locator(".cm-content").press("ControlOrMeta+End"); await target.locator(".cm-content").press("Enter"); await target.locator(".cm-content").pressSequentially("LOCAL UNSAVED");
    const conflict = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 409);
    await target.locator(".cm-content").press("ControlOrMeta+s"); await conflict;
    await target.getByRole("button", { name: "另存冲突副本", exact: true }).waitFor();
    ensure((await target.locator(".cm-content").innerText()).includes("LOCAL UNSAVED"), "冲突吞掉本地编辑");
    ensure(!(await target.locator(".cm-content").innerText()).includes("REMOTE EDIT"), "冲突静默替换为远端正文");
    await target.getByRole("button", { name: "另存冲突副本", exact: true }).click();
    await target.getByRole("button", { name: "另存冲突副本", exact: true }).waitFor({ state: "hidden" });
    checks.push("真实 409 保留两端内容，完整资源另存冲突副本");

    step = "lost response";
    let dropped = false, operations = [];
    await context.route("**/api/v1/articles/*", async route => {
      if (route.request().method() !== "PUT") return route.continue();
      operations.push(route.request().postData()?.match(/"operationId":"([^"]+)"/)?.[1]);
      if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
    });
    await target.locator(".cm-content").press("ControlOrMeta+End"); await target.locator(".cm-content").press("Enter"); await target.locator(".cm-content").pressSequentially("LOST RESPONSE RECOVERED");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByRole("heading", { name: "工作区暂不可用" }).waitFor();
    const rescue = target.waitForEvent("download"); await target.getByRole("button", { name: "下载当前正文", exact: true }).click();
    await (await rescue).saveAs("output/playwright/p3-offline-rescue.md");
    await target.getByRole("button", { name: "重新验证会话", exact: true }).click();
    await target.locator(".cm-content").waitFor({ state: "visible" });
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    ensure(operations.length >= 2 && operations[0] && operations[0] === operations[1], "丢响应重试未复用 operationId");
    await context.unroute("**/api/v1/articles/*");
    checks.push("真实服务提交后丢响应：遮蔽视图、正文抢救、重连同 operationId 成功");

    step = "logout tabs";
    const other = await context.newPage(); await other.goto(origin + "/nested/"); await other.locator(".cm-content").waitFor();
    await target.bringToFront(); await target.locator(".cm-content").waitFor({ state: "visible" });
    await target.getByRole("button", { name: "保存并退出", exact: true }).click();
    await target.getByRole("button", { name: "登录", exact: true }).waitFor();
    await other.getByRole("button", { name: "登录", exact: true }).waitFor();
    ensure(!(await target.locator("body").innerText()).includes(marker), "主动退出仍可见旧正文");
    ensure(!(await other.locator("body").innerText()).includes(marker), "旧标签仍可见旧正文");
    await login(target, "bob");
    ensure(!(await target.locator("body").innerText()).includes(marker), "换账号展示前用户正文");
    await other.bringToFront(); await other.locator(".server-workspace-panel").waitFor({ state: "visible" });
    ensure(!(await other.locator("body").innerText()).includes(marker), "旧标签恢复泄漏前用户正文");
    checks.push("主动退出广播到旧标签；换账号、页面恢复均不显示前用户内容");

    step = "cache";
    const cachedApi = await target.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const urls = [];
      for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) if (/\/api\//.test(request.url)) urls.push(request.url);
      return urls;
    });
    ensure(cachedApi.length === 0 && privateCacheHeaders.every(value => value === "no-store"), "私有响应进入缓存或缺少 no-store");
    await target.setViewportSize({ width: 390, height: 844 });
    await target.bringToFront();
    await target.locator('[data-layout-mode="mobile"]').waitFor({ state: "visible" });
    ensure(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "移动布局发生水平溢出");
    await target.getByRole("button", { name: "文章列表", exact: true }).click();
    const mobileDialog = target.getByRole("dialog", { name: "服务器文章", exact: true });
    await mobileDialog.getByRole("button", { name: "新建文章", exact: true }).click();
    await mobileDialog.locator(".fs-item.active").waitFor();
    await mobileDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await target.locator(".cm-content").waitFor({ state: "visible" });
    await target.screenshot({ path: "output/playwright/p3-server-mobile.png" });
    checks.push("生产 Service Worker 无 API 缓存，私有响应 no-store；390px 布局截图");
    ensure(errors.length === 0, errors.join(" | "));
    return { checks, errors, privateResponses: privateCacheHeaders.length, cachedApi, articleId };
  } catch (error) {
    if (target) await target.screenshot({ path: "output/playwright/p3-server-failure.png" });
    throw new Error(`${step}: ${error.message}`);
  } finally { for (const context of contexts) await context.close(); }
}
