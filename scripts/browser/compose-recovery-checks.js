// Playwright CLI run-code --filename；配合 compose-smoke.mjs --recovery --serve。
// 只使用本机合成账号、独立卷与临时浏览器上下文。每次备份/恢复使用新的合成目标。
// prettier-ignore
async (page) => {
  const context = await page.context().browser().newContext({ ignoreHTTPSErrors: true });
  const target = await context.newPage(), errors = [], statuses = [];
  const origin = "https://127.0.0.1:4185", url = origin + "/nested/";
  const ensure = (ok, message) => { if (!ok) throw new Error(message); };
  target.on("pageerror", error => errors.push(error.message));
  target.on("response", response => { if (response.url().includes("/api/v1/")) statuses.push({ status: response.status(), cache: response.headers()["cache-control"] }); });
  const login = async () => {
    await target.getByRole("textbox", { name: "用户名", exact: true }).fill("alice");
    await target.getByRole("textbox", { name: "密码", exact: true }).fill("synthetic-web-password");
    await target.getByRole("button", { name: "登录", exact: true }).click();
    await target.locator(".server-workspace-panel").waitFor();
  };
  const recovery = async action => {
    const response = await context.request.post(`${origin}/__fixture/recovery/${action}`, { headers: { Origin: origin }, timeout: 120000 });
    ensure(response.ok(), `恢复夹具 ${action} 失败: ${response.status()}`);
    return response.json();
  };
  const imageReady = () => target.waitForFunction(() => {
    const img = document.querySelector('.preview-content img[src^="blob:"]');
    return img?.complete && img.naturalWidth === 2;
  });
  try {
    await target.goto(url); await login();
    const created = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 201);
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    const id = new URL((await created).url()).pathname.split("/").at(-1);
    await target.locator(".cm-content").filter({ hasText: "新文章" }).waitFor();
    const title = "P4 recovery " + Date.now();
    const savedText = `# ${title}\n备份内的正文`;
    await target.locator(".cm-content").fill(savedText);
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const png = await target.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 2; const ctx = c.getContext("2d"); ctx.fillStyle = "#00aa88"; ctx.fillRect(0,0,2,2); return c.toDataURL("image/png").split(",")[1]; });
    const choose = target.waitForEvent("filechooser");
    await target.getByRole("button", { name: "选择图片", exact: true }).click();
    await (await choose).setFiles({ name: "recovery.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await imageReady();
    await target.locator(".fs-item.active .fs-action-trigger").click();
    await target.getByRole("button", { name: "重命名", exact: true }).click();
    await target.locator(".fs-rename input").fill(title);
    await target.locator(".fs-rename").getByRole("button", { name: "确认", exact: true }).click();
    await target.locator(".fs-item.active .fs-title").filter({ hasText: title }).waitFor();
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const saved = await (await context.request.get(`${url}api/v1/articles/${id}`)).json();
    const before = await recovery("backup");
    await target.locator(".cm-content").fill(saved.markdown + "\n备份之后的新内容，应在恢复后消失");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    // 保持旧页面及旧内存状态；恢复后真实尝试保存，必须由后端拒绝。
    const after = await recovery("restore");
    ensure(before.deploymentId === after.deploymentId && before.workspaceEpoch !== after.workspaceEpoch, "恢复身份/epoch 不符合契约");
    const rejected = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 401);
    await target.locator(".cm-content").fill(saved.markdown + "\n旧标签恢复后尝试覆盖");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await rejected;
    await target.getByRole("button", { name: "登录", exact: true }).waitFor();
    ensure(await target.locator(".cm-content:visible").count() === 0, "旧编辑器未遮蔽");
    ensure(!(await target.locator("body").innerText()).includes("备份之后的新内容"), "旧私有正文仍可见");
    ensure(await target.locator('.preview-content img[src^="blob:"]').count() === 0, "旧原图仍可见");
    await target.getByRole("button", { name: "重新连接", exact: true }).click();
    await target.getByText("请登录服务器工作区", { exact: true }).waitFor();
    await login();
    // 初始工作区会异步选中首篇；等首篇加载完再发起显式选择，避免夹具抢先点击。
    await target.getByText("就绪", { exact: true }).waitFor();
    await target.locator(".fs-item").filter({ has: target.locator(".fs-title", { hasText: title }) }).click();
    await target.locator(".fs-item.active .fs-title").filter({ hasText: title }).waitFor();
    await target.locator(".cm-content").filter({ hasText: "备份内的正文" }).waitFor(); await imageReady();
    const restored = await (await context.request.get(`${url}api/v1/articles/${id}`)).json();
    ensure(JSON.stringify(restored) === JSON.stringify(saved), "正文、元数据、原图清单或 revision 未恢复到备份版本");
    const asset = restored.assets[0];
    const original = await context.request.get(`${url}api/v1/articles/${id}/assets/${encodeURIComponent(asset.path.slice(6))}?revision=${restored.revision}`);
    ensure((await original.body()).equals(Buffer.from(png, "base64")), "恢复原图字节变化");
    await target.locator(".cm-content").fill(saved.markdown + "\n恢复后新登录保存");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const updated = await (await context.request.get(`${url}api/v1/articles/${id}`)).json();
    ensure(updated.revision === saved.revision + 1, "恢复后合法保存没有推进版本");
    const cache = await target.evaluate(async () => {
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("SW ready timeout")), 20000))]);
      const api = []; for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) if (/\/api\//.test(req.url)) api.push(req.url);
      return { api, local: Object.values(localStorage).some(v => v.includes("备份内的正文") || v.includes("备份之后的新内容")) };
    });
    ensure(cache.api.length === 0 && !cache.local, "私有正文/响应进入持久缓存");
    ensure(statuses.every(r => r.cache === "no-store"), "API 缓存策略变化");
    ensure(errors.length === 0, errors.join(" | "));
    await target.screenshot({ path: "output/playwright/p4-recovery.png" });
    return { checks: ["实际旧页保存被 401 拒绝并清理正文与 Blob 原图", "重新登录保留归属，恢复备份正文/元数据/revision/原图字节", "恢复后新提交可用，私有 API no-store、SW 无 API、本地存储无合成正文"], responses: statuses.length, errors };
  } catch (error) {
    await target.screenshot({ path: "output/playwright/p4-recovery-failure.png" });
    throw error;
  } finally { await context.close(); }
}
