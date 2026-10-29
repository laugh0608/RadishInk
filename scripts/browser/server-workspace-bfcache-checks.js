// Playwright 默认关闭 BFCache；本合成探针只移除该启动参数，实际核对 persisted。
// prettier-ignore
async (page) => {
  const browser = await page.context().browser().browserType().launch({ channel: "chrome", headless: true, ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      window.__p3Restore = [];
      window.addEventListener("pageshow", event => window.__p3Restore.push({ persisted: event.persisted, masked: document.documentElement.hasAttribute("data-private-workspace-masked") }));
    });
    const target = await context.newPage(); await target.goto("http://127.0.0.1:4193/nested/");
    await target.getByRole("textbox", { name: "用户名", exact: true }).fill("alice");
    await target.getByRole("textbox", { name: "密码", exact: true }).fill("synthetic-web-password");
    await target.getByRole("button", { name: "登录", exact: true }).click();
    await target.locator(".server-workspace-panel").waitFor({ state: "visible" });
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    await target.locator(".cm-content").waitFor({ state: "visible" });
    const other = await context.newPage(); await other.goto("http://127.0.0.1:4193/nested/");
    await other.locator(".cm-content").waitFor({ state: "visible" });
    await target.bringToFront(); await target.locator(".cm-content").waitFor({ state: "visible" });
    await target.goto("http://127.0.0.1:4193/nested/favicon-dark.svg");
    await other.evaluate(async () => {
      const session = await (await fetch("/nested/api/v1/auth/session", { cache: "no-store" })).json();
      const response = await fetch("/nested/api/v1/auth/logout", { method: "POST", headers: { "X-CSRF-Token": session.csrfToken } });
      if (response.status !== 204) throw new Error("synthetic revocation failed");
    });
    await target.evaluate(() => history.back());
    await target.getByRole("button", { name: "登录", exact: true }).waitFor();
    const restored = await target.evaluate(() => ({ events: window.__p3Restore, reasons: performance.getEntriesByType("navigation")[0]?.notRestoredReasons?.toJSON?.() }));
    if (!restored.events.some(event => event.persisted)) throw new Error("没有实际命中 BFCache: " + JSON.stringify(restored));
    if (!restored.events.filter(event => event.persisted).every(event => event.masked)) throw new Error("BFCache 恢复瞬间未遮蔽旧正文");
    if (await target.locator(".cm-content").count()) throw new Error("撤销后仍保留旧编辑器");
    await target.screenshot({ path: "output/playwright/p3-server-bfcache.png" });
    return { check: "实际 BFCache 命中，恢复瞬间保持遮蔽，随后撤销会话清除旧编辑器", ...restored };
  } finally { await context.close(); await browser.close(); }
}
