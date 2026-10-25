// 生产构建中的撤销、断网旧标签、历史后退、pageshow 与完整 API 前缀缓存边界。
// Playwright CLI run-code --filename；运行 server-workspace-server.cjs 后执行。
// prettier-ignore
async (page) => {
  const origin = "http://127.0.0.1:4193", context = await page.context().browser().newContext({ acceptDownloads: true });
  const checks = [], errors = [];
  let step = "create", target;
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const login = async target => {
    await target.getByRole("textbox", { name: "用户名", exact: true }).fill("alice");
    await target.getByRole("textbox", { name: "密码", exact: true }).fill("synthetic-web-password");
    await target.getByRole("button", { name: "登录", exact: true }).click();
    await target.locator(".server-workspace-panel").waitFor({ state: "visible" });
  };
  const revoke = target => target.evaluate(async () => {
    const session = await (await fetch("/nested/api/v1/auth/session", { cache: "no-store" })).json();
    const response = await fetch("/nested/api/v1/auth/logout", { method: "POST", headers: { "X-CSRF-Token": session.csrfToken } });
    if (response.status !== 204) throw new Error("会话撤销失败");
  });
  try {
    await context.addInitScript(() => {
      window.__p3PageShows = [];
      window.addEventListener("pageshow", event => window.__p3PageShows.push({ persisted: event.persisted }));
    });
    target = await context.newPage(); target.on("pageerror", error => errors.push(error.message));
    await target.goto(origin + "/nested/"); await login(target);
    const marker = "privacy-check-" + Date.now();
    const created = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 201);
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    const articleId = (await (await created).json()).articleId;
    await target.locator(".cm-content").filter({ hasText: "新文章" }).waitFor();
    const save = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 200);
    await target.locator(".cm-content").fill("# " + marker); await target.locator(".cm-content").press("ControlOrMeta+s"); await save;
    await target.getByText("刚刚保存", { exact: true }).waitFor();

    step = "rename";
    await target.locator(".fs-item.active .fs-action-trigger").click();
    await target.getByRole("button", { name: "重命名", exact: true }).click();
    await target.locator(".fs-item.active .fs-rename input").fill(marker);
    await target.locator(".fs-item.active .fs-rename input").press("Enter");
    await target.getByText("已重命名", { exact: true }).waitFor();
    const renamed = await target.evaluate(async id => (await fetch(`/nested/api/v1/articles/${id}`, { cache: "no-store" })).json(), articleId);
    ensure(renamed.metadata.title === marker, "标题未更新或文章 ID 发生变化");
    checks.push("真实 UI 重命名更新标题并保留文章 UUID");

    step = "offline tab broadcast";
    const other = await context.newPage(); other.on("pageerror", error => errors.push(error.message));
    await other.goto(origin + "/nested/"); await other.locator(".cm-content").waitFor();
    await target.bringToFront(); await target.locator(".cm-content").waitFor({ state: "visible" });
    await target.locator(".fs-item.active .fs-action-trigger").click();
    await target.getByRole("button", { name: "删除", exact: true }).click();
    await target.getByRole("button", { name: "确认删除", exact: true }).waitFor();
    await target.route("**/api/v1/**", route => route.abort("internetdisconnected"));
    await target.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await target.getByRole("button", { name: "下载当前正文", exact: true }).waitFor();
    ensure(!await target.getByRole("button", { name: "确认删除", exact: true }).isVisible(), "断网遮蔽遗漏 body portal 私有弹窗");
    await other.bringToFront(); await other.locator(".cm-content").waitFor({ state: "visible" });
    await other.getByRole("button", { name: "保存并退出", exact: true }).click();
    await other.getByRole("button", { name: "登录", exact: true }).waitFor();
    await target.getByRole("button", { name: "重新连接", exact: true }).waitFor();
    ensure(!(await target.locator("body").innerText()).includes(marker), "断网旧标签仍显示前用户内容");
    ensure(await target.getByRole("button", { name: "下载当前正文", exact: true }).isVisible().catch(() => false) === false, "退出广播后旧标签仍提供私有抢救内容");
    ensure(await target.locator(".cm-content").count() === 0, "退出广播未销毁旧编辑器与撤销历史");
    checks.push("断网遮蔽包含私有弹窗；旧标签收到退出广播即清除正文、撤销历史和抢救入口");
    await target.unroute("**/api/v1/**");
    await target.getByRole("button", { name: "重新连接", exact: true }).click();
    await login(target);

    step = "revocation pageshow";
    await other.goto(origin + "/nested/"); await other.locator(".cm-content").waitFor();
    await target.bringToFront(); await target.locator(".cm-content").waitFor({ state: "visible" });
    await revoke(other);
    await target.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await target.getByRole("button", { name: "登录", exact: true }).waitFor();
    ensure(await target.locator(".cm-content").count() === 0, "pageshow 失效会话仍展示旧编辑器");
    checks.push("撤销会话后 persisted pageshow 事件先遮蔽再清除旧视图（事件注入）");

    step = "history back";
    await login(target); await target.goto("about:blank");
    await other.goto(origin + "/nested/"); await other.locator(".cm-content").waitFor();
    await revoke(other); await target.goBack();
    await target.getByRole("button", { name: "登录", exact: true }).waitFor();
    ensure(await target.locator(".cm-content").count() === 0, "历史后退展示已撤销的私有正文");
    const pageShows = await target.evaluate(() => window.__p3PageShows);
    checks.push("真实导航后退重新验证已撤销会话；实际 BFCache 命中另列");

    step = "delete";
    await login(target);
    await target.locator(".fs-item").filter({ hasText: marker }).click();
    await target.locator(".cm-content").filter({ hasText: marker }).waitFor();
    await target.locator(".fs-item.active .fs-action-trigger").click();
    await target.getByRole("button", { name: "删除", exact: true }).click();
    await target.getByText(/正文和图片将从服务器工作区删除/).waitFor();
    await target.getByRole("button", { name: "确认删除", exact: true }).click();
    await target.getByText("已删除", { exact: true }).waitFor();
    const deleted = await target.evaluate(async id => (await fetch(`/nested/api/v1/articles/${id}`, { cache: "no-store" })).status, articleId);
    ensure(deleted === 404, "删除后文章仍可读取");
    checks.push("真实 UI 删除后列表移除，授权读取返回 404");

    step = "service worker API denylist";
    await target.evaluate(() => navigator.serviceWorker.ready); await target.reload();
    await target.waitForFunction(() => !!navigator.serviceWorker.controller);
    const response = await target.goto(origin + "/nested/api/v1/unknown-boundary-check");
    ensure(response.status() === 404 && response.headers()["content-type"].includes("application/json"), "API 导航被 Service Worker 回退为 HTML");
    await context.setOffline(true);
    const offline = await target.evaluate(async () => { try { await fetch("/nested/api/v1/capabilities", { cache: "no-store" }); return false; } catch { return true; } });
    ensure(offline, "离线 API 意外返回缓存响应");
    checks.push("受控生产 SW 的未知 API 导航保留 JSON 404；离线 API 不返回缓存或 HTML");
    ensure(errors.length === 0, errors.join(" | "));
    return { checks, pageShows, actualBfCacheHit: pageShows.some(event => event.persisted), errors };
  } catch (error) {
    if (target) await target.screenshot({ path: "output/playwright/p3-server-privacy-failure.png" });
    throw new Error(`${step}: ${error.message}`);
  } finally { await context.close(); }
}
