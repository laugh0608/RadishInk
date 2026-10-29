// Playwright CLI run-code --filename；配合 compose-smoke.mjs --serve。
// 另启动正式 Web dist 的本机静态预览 4187；只用临时浏览器与合成账号。
// prettier-ignore
async (page) => {
  const checks = [], errors = [], browser = page.context().browser();
  const contexts = [];
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const make = async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    contexts.push(context); return context;
  };
  const menu = async (target, name) => {
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.getByRole("menuitem", { name, exact: true }).click();
  };
  let target;
  try {
    for (const origin of ["http://127.0.0.1:4186", "http://127.0.0.1:4187"]) {
      const context = await make(); target = await context.newPage();
      const api = []; target.on("request", r => { if (/\/api\//.test(r.url())) api.push(r.url()); });
      await target.goto(origin); await target.locator(".cm-content").waitFor();
      await target.locator(".cm-content").fill("# P4 static synthetic\n浏览器保存");
      await target.locator(".cm-content").press("ControlOrMeta+s");
      await target.getByText("刚刚保存", { exact: true }).waitFor();
      await target.reload(); await target.locator(".cm-content").filter({ hasText: "P4 static synthetic" }).waitFor();
      ensure(api.length === 0, `${origin} 静态形态请求了 API`);
      await context.close(); contexts.splice(contexts.indexOf(context), 1);
      checks.push(`${origin} 静态构建：保存、刷新恢复，无 API 请求`);
    }
    const context = await make(); target = await context.newPage();
    target.on("pageerror", error => errors.push(error.message));
    const headers = [];
    target.on("response", response => { if (response.url().includes("/api/v1/")) headers.push(response.headers()["cache-control"]); });
    await target.goto("https://127.0.0.1:4185/nested/");
    const login = async username => {
      await target.getByRole("textbox", { name: "用户名", exact: true }).fill(username);
      await target.getByRole("textbox", { name: "密码", exact: true }).fill("synthetic-web-password");
      await target.getByRole("button", { name: "登录", exact: true }).click();
      await target.locator(".server-workspace-panel").waitFor();
    };
    await login("alice");
    const cookies = await context.cookies();
    ensure(cookies.some(c => c.name === "__Host-radishink-session" && c.secure && c.httpOnly), "没有生产 Secure 会话 Cookie");
    const created = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 201);
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    const id = new URL((await created).url()).pathname.split("/").at(-1);
    await target.locator(".cm-content").filter({ hasText: "新文章" }).waitFor();
    const marker = "P4 browser synthetic " + Date.now();
    await target.locator(".cm-content").fill(`# ${marker}\nCompose 浏览器正文`);
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const png = await target.evaluate(() => { const c=document.createElement("canvas");c.width=c.height=2;const ctx=c.getContext("2d");ctx.fillStyle="#ff6622";ctx.fillRect(0,0,2,2);return c.toDataURL("image/png").split(",")[1]; });
    const choose = target.waitForEvent("filechooser");
    await target.getByRole("button", { name: "选择图片", exact: true }).click();
    await (await choose).setFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(png,"base64") });
    const imageReady = async () => target.waitForFunction(() => { const img=document.querySelector('.preview-content img[src^="blob:"]');return img?.complete && img.naturalWidth===2; });
    await imageReady(); await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const download = target.waitForEvent("download"); await menu(target, "导出当前文章包（.zip）");
    await (await download).saveAs("output/playwright/p4-compose.zip");
    const importing = target.waitForEvent("filechooser"); await menu(target, "导入文章包（.zip）…");
    const imported = target.waitForResponse(r => r.request().method()==="PUT" && r.status()===201);
    await (await importing).setFiles("output/playwright/p4-compose.zip");
    const newId = new URL((await imported).url()).pathname.split("/").at(-1);
    ensure(newId !== id, "回导未创建新文章身份");
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await imageReady();
    const importedTitle = marker + " imported";
    await target.locator(".fs-item.active .fs-action-trigger").click();
    await target.getByRole("button", { name: "重命名", exact: true }).click();
    await target.locator(".fs-rename input").fill(importedTitle);
    await target.locator(".fs-rename").getByRole("button", { name: "确认", exact: true }).click();
    await target.locator(".fs-item.active .fs-title").filter({ hasText: importedTitle }).waitFor();
    await target.reload();
    await target.locator(".fs-item").filter({ has: target.locator(".fs-title", { hasText: importedTitle }) }).click();
    await target.locator(".cm-content").filter({ hasText: marker }).waitFor(); await imageReady();
    checks.push("真实 HTTPS + Nginx + Nest：生产 Cookie、登录、文章/图片、ZIP 新身份回导与刷新恢复");
    await target.screenshot({ path: "output/playwright/p4-compose-desktop.png" });
    const cachedApi = await target.evaluate(async () => {
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("SW readiness timeout; check synthetic TLS certificate trust")), 15000))]);
      const urls=[];for(const key of await caches.keys())for(const r of await (await caches.open(key)).keys())if(/\/api\//.test(r.url))urls.push(r.url);
      return urls;
    });
    ensure(cachedApi.length === 0 && headers.every(v => v === "no-store"), "私有 API 被缓存");
    const other = await context.newPage(); await other.goto("https://127.0.0.1:4185/nested/");
    await other.locator(".cm-content").waitFor(); await target.bringToFront();
    await target.getByRole("button", { name: "保存并退出", exact: true }).click();
    await other.getByRole("button", { name: "登录", exact: true }).waitFor();
    await login("bob");
    ensure(!(await target.locator("body").innerText()).includes(marker), "换账号泄露旧正文");
    checks.push("私有响应 no-store、生产 SW 无 API 缓存、多标签退出与换账号遮蔽");
    ensure(errors.length === 0, errors.join(" | "));
    return { checks, errors, privateResponses: headers.length, cachedApi };
  } catch (error) {
    if (target) await target.screenshot({ path: "output/playwright/p4-compose-failure.png" });
    throw error;
  } finally { for (const context of contexts) await context.close(); }
}
