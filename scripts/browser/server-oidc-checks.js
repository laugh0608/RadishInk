// Playwright CLI run-code --filename；先运行 server-oidc-server.cjs，全部为合成账号。
// prettier-ignore
async (page) => {
  const browser = page.context().browser(), contexts = [], checks = [], errors = [], requests = [];
  const context = await browser.newContext(); contexts.push(context);
  let target = await context.newPage(), step = "dual login";
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const watch = tab => {
    tab.on("pageerror", error => errors.push(error.message));
    tab.on("response", response => { if (new URL(response.url()).pathname.includes("/api/")) requests.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() }); });
  };
  watch(target);
  try {
    await target.goto("http://127.0.0.1:4194/nested/");
    await target.getByRole("textbox", { name: "用户名", exact: true }).fill("alice");
    await target.getByRole("textbox", { name: "密码", exact: true }).fill("synthetic-oidc-password");
    await target.getByRole("button", { name: "登录", exact: true }).click();
    await target.locator(".server-workspace-panel").waitFor({ state: "visible" });
    const created = target.waitForResponse(r => r.request().method() === "PUT" && r.status() === 201);
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    const articleId = new URL((await created).url()).pathname.split('/').at(-1);
    await target.locator(".cm-content").filter({ hasText: "新文章" }).waitFor();
    const marker = "OIDC 原稿 " + Date.now();
    await target.locator(".cm-content").fill("# " + marker);
    const other = await context.newPage(); watch(other);
    await other.goto("http://127.0.0.1:4194/nested/");
    await target.bringToFront(); await target.locator(".cm-content").waitFor({ state: "visible" });
    await target.getByText("账号登录方式", { exact: true }).click();
    await target.getByLabel("验证本站密码", { exact: true }).fill("synthetic-oidc-password");
    await target.getByRole("button", { name: "验证并绑定 Radish", exact: true }).click();
    await target.getByRole("heading", { name: "合成 Radish 发行方" }).waitFor();
    await target.getByRole("link", { name: "授权合成账号", exact: true }).click();
    await target.locator(".cm-content").filter({ hasText: marker }).waitFor();
    ensure(new URL(target.url()).search === "", "回调没有清理业务 URL");
    const bound = await target.evaluate(async id => {
      const session = await (await fetch("/nested/api/v1/auth/session", { cache: "no-store" })).json();
      const article = await (await fetch("/nested/api/v1/articles/" + id, { cache: "no-store" })).json();
      return { user: session.user, article };
    }, articleId);
    ensure(bound.user.username === "alice" && bound.article.markdown.includes(marker), "绑定未保留用户或保存后的原稿");
    await other.bringToFront(); await other.locator(".cm-content").filter({ hasText: marker }).waitFor();
    checks.push("双登录 UI：先保存原稿，再验证密码、真实授权回调；保留内部账号与文章，多标签重新验证");

    step = "OIDC login existing identity";
    await target.bringToFront();
    await target.getByRole("button", { name: "保存并退出", exact: true }).click();
    await target.getByRole("button", { name: "使用 Radish 登录", exact: true }).click();
    await target.getByRole("link", { name: "授权合成账号", exact: true }).click();
    await target.locator(".cm-content").filter({ hasText: marker }).waitFor();
    const same = await target.evaluate(async () => (await (await fetch("/nested/api/v1/auth/session")).json()).user.userId);
    ensure(same === bound.user.userId, "OIDC 登录更改了本地文章归属");
    const browserState = await target.evaluate(async () => {
      const local = Object.values(localStorage).join("\n"), records = [];
      for (const { name } of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        for (const store of db.objectStoreNames) records.push(await new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }));
        db.close();
      }
      return local + JSON.stringify(records);
    });
    ensure(!browserState.includes(marker) && !/fixture-access-|synthetic-oidc-client-secret|eyJhbGciOiJSUzI1Ni/.test(browserState), "私有正文或上游凭据进入浏览器持久存储");
    checks.push("OIDC 登录返回同一内部 ID 与文章，回调参数移除，私有正文与上游 Token / secret 不进入浏览器存储");

    step = "unlink and pending";
    await target.getByText("账号登录方式", { exact: true }).click();
    await target.getByLabel("验证本站密码", { exact: true }).fill("synthetic-oidc-password");
    await target.getByRole("checkbox", { name: "解除绑定并退出本站，之后使用本地密码登录", exact: true }).check();
    await target.getByRole("button", { name: "验证并解除 Radish 绑定", exact: true }).click();
    await target.getByRole("button", { name: "登录", exact: true }).waitFor();
    await target.getByRole("button", { name: "使用 Radish 登录", exact: true }).click();
    await target.getByRole("link", { name: "授权合成账号", exact: true }).click();
    await target.getByRole("region", { name: "服务器会话" }).getByText(/等待部署管理员批准后才能使用服务器文章/).waitFor();
    ensure(await target.locator(".cm-content").count() === 0, "待准入用户仍有旧编辑器");
    await target.screenshot({ path: "output/playwright/p3-oidc-pending.png" });
    checks.push("真实 UI 重新验证密码后解除绑定并退出；未绑定身份首次登录进入待准入，无文章权限");

    step = "local draft cancellation";
    const local = await browser.newContext(); contexts.push(local);
    target = await local.newPage(); watch(target);
    await target.goto("http://127.0.0.1:4194/nested/");
    await target.getByRole("button", { name: "使用浏览器存储", exact: true }).click();
    await target.locator(".cm-content").waitFor();
    const localMarker = "取消登录后保留的本地稿件 " + Date.now();
    await target.locator(".cm-content").fill("# " + localMarker);
    await target.getByRole("button", { name: "存储模式", exact: true }).click();
    await target.getByRole("button", { name: "使用 Radish 登录", exact: true }).click();
    await target.getByRole("link", { name: "取消授权", exact: true }).click();
    await target.locator(".cm-content").filter({ hasText: localMarker }).waitFor();
    await target.getByRole("button", { name: "存储模式", exact: true }).click();
    await target.getByText(/已取消 Radish 授权/).waitFor();
    checks.push("本地稿件从存储设置跳转前已保存；合成发行方取消后恢复原稿与浏览器模式");

    step = "OIDC only mobile";
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); contexts.push(mobile);
    target = await mobile.newPage(); watch(target);
    await target.goto("http://127.0.0.1:4195/nested/");
    await target.getByRole("button", { name: "使用 Radish 登录", exact: true }).waitFor();
    ensure(await target.getByRole("textbox", { name: "密码", exact: true }).count() === 0, "仅 OIDC 部署显示密码入口");
    await target.getByRole("button", { name: "使用 Radish 登录", exact: true }).click();
    await target.getByRole("link", { name: "授权合成账号", exact: true }).click();
    await target.getByRole("button", { name: "文章列表", exact: true }).click();
    const dialog = target.getByRole("dialog", { name: "服务器文章", exact: true });
    await dialog.getByRole("button", { name: "新建文章", exact: true }).click();
    await dialog.locator(".fs-item.active").waitFor();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await target.locator(".cm-content").fill("# OIDC 手机模拟正文");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const overflow = await target.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    ensure(!overflow, "OIDC 手机布局横向溢出");
    await target.screenshot({ path: "output/playwright/p3-oidc-mobile.png" });
    checks.push("仅 OIDC 的生产 UI 不提供密码入口；390px 触屏布局完成登录、新建和保存，无横向溢出");
    ensure(errors.length === 0, errors.join(" | "));
    return { checks, errors };
  } catch (error) {
    await target.screenshot({ path: "output/playwright/p3-oidc-failure.png" });
    throw new Error(step + ": " + error.message + " | " + JSON.stringify({ requests: requests.slice(-24), panel: await target.locator(".server-account-connections").textContent().catch(() => "") }));
  } finally { for (const context of contexts) await context.close(); }
}
