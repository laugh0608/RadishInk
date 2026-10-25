// Production upgrade under /nested/. OPFS and native directory handles are real;
// picker, permission denial and write failure are explicit test substitutes.
// prettier-ignore
async (page) => {
  const origin = "http://127.0.0.1:4183";
  const context = await page.context().browser().newContext({ acceptDownloads: true, hasTouch: true });
  context.setDefaultTimeout(20_000);
  const target = await context.newPage(), errors = [], checks = [];
  let step = "setup";
  target.on("pageerror", error => errors.push(error.message));
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  const select = async version => { ensure((await context.request.post(`${origin}/__test/select?version=${version}`)).ok(), "fixture switch failed"); };
  const imageReady = () => target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
  const files = () => target.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("pwa-upgrade-directory");
    const result = [];
    for await (const [name, entry] of root.entries()) {
      if (entry.kind !== "directory" || name.startsWith(".")) continue;
      let md; try { md = await (await entry.getFileHandle("index.md")).getFile(); } catch { continue; }
      const assets = [];
      for await (const [path, asset] of (await entry.getDirectoryHandle("asset")).entries()) assets.push({ path, bytes: [...new Uint8Array(await (await asset.getFile()).arrayBuffer())] });
      result.push({ name, markdown: await md.text(), assets });
    }
    return result;
  });
  try {
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () => {
        localStorage.setItem("pwa-picker-count", String(Number(localStorage.getItem("pwa-picker-count") || 0) + 1));
        return (await navigator.storage.getDirectory()).getDirectoryHandle("pwa-upgrade-directory", { create: true });
      };
      const query = FileSystemDirectoryHandle.prototype.queryPermission;
      const request = FileSystemDirectoryHandle.prototype.requestPermission;
      FileSystemDirectoryHandle.prototype.queryPermission = async function (...args) {
        if (this.name === "pwa-upgrade-directory" && localStorage.getItem("pwa-test-permission") === "prompt") return "prompt";
        return query.apply(this, args);
      };
      FileSystemDirectoryHandle.prototype.requestPermission = async function (...args) {
        if (this.name === "pwa-upgrade-directory") localStorage.removeItem("pwa-test-permission");
        return request.apply(this, args);
      };
    });
    await select("new"); await target.goto(origin + "/nested/"); await target.locator(".cm-content").waitFor();
    await target.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await target.reload(); await target.locator(".cm-content").waitFor();
    await target.getByRole("button", { name: "存储模式", exact: true }).click();
    await target.getByRole("button", { name: /^本地文件夹 / }).click();
    await target.getByRole("button", { name: "关闭", exact: true }).click();
    const choosing = target.waitForEvent("filechooser");
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.getByRole("menuitem", { name: "导入 Markdown 为新文章…", exact: true }).click();
    await (await choosing).setFiles({ name: "目录升级.md", mimeType: "text/markdown", buffer: Buffer.from("---\ncustomFlag: directory-pwa\ntitle: 目录升级\n---\n# 目录升级正文\n") });
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ff9933"; ctx.fillRect(0, 0, 2, 2);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], "合成图.png", { type: "image/png" }));
      document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
    });
    await imageReady(); await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    const before = await files(); ensure(before.length === 1 && before[0].assets.length === 1, "directory fixture missing");
    await select("next");
    await target.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await target.getByText("新版本已准备好", { exact: true }).waitFor();
    step = "directory write failure";
    await target.locator(".cm-content").press("ControlOrMeta+End"); await target.locator(".cm-content").pressSequentially(" directory-latest-unsaved");
    await target.evaluate(() => {
      const original = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async () => { throw new DOMException("synthetic directory denied", "NotAllowedError"); };
      window.__restoreWrites = () => { FileSystemFileHandle.prototype.createWritable = original; };
    });
    await target.getByRole("button", { name: "保存并更新", exact: true }).click();
    await target.getByRole("complementary", { name: "应用更新" }).getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
    ensure(await target.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), "directory failure activated worker");
    ensure((await target.locator(".cm-content").innerText()).includes("directory-latest-unsaved"), "directory failure lost input");
    ensure(JSON.stringify((await files())[0].assets) === JSON.stringify(before[0].assets), "failure changed resources");
    await target.evaluate(() => window.__restoreWrites());
    checks.push("生产目录保存遭注入拒写：未激活、正文保留、原图字节不变；可在原页面重试");

    step = "directory upgrade with permission restoration";
    await target.evaluate(() => localStorage.setItem("pwa-test-permission", "prompt"));
    await target.setViewportSize({ width: 390, height: 844 });
    const box = await target.getByRole("complementary", { name: "应用更新" }).boundingBox();
    ensure(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845, "mobile update notice clipped");
    await target.screenshot({ path: "output/playwright/pwa-mobile-notice.png" });
    await target.getByRole("button", { name: "保存并更新", exact: true }).click();
    await target.waitForFunction(() => document.documentElement.dataset.pwaFixture === "next");
    await target.getByRole("button", { name: "重新授权原文件夹", exact: true }).waitFor();
    ensure(await target.evaluate(() => localStorage.getItem("pwa-picker-count")) === "1", "upgrade opened a new picker");
    await target.getByRole("button", { name: "重新授权原文件夹", exact: true }).click();
    await target.locator(".cm-content").waitFor();
    await target.getByRole("button", { name: "预览", exact: true }).click();
    await imageReady();
    const after = await files();
    ensure(after[0].markdown.includes("directory-latest-unsaved") && after[0].markdown.includes("customFlag: directory-pwa"), "directory latest snapshot missing");
    ensure(JSON.stringify(after[0].assets) === JSON.stringify(before[0].assets), "directory assets changed");
    ensure(await target.evaluate(() => localStorage.getItem("pwa-picker-count")) === "1", "reauthorization replaced directory");
    checks.push("/nested/ 相对部署、390px 更新提示、保存后接管；重载缺权仍保留目录模式，重新授权原句柄后正文与原图恢复");
    await target.screenshot({ path: "output/playwright/pwa-directory-restored.png" });
    ensure(errors.length === 0, errors.join(" | "));
    return { checks, errors, browser: await context.browser().version(), directory: after.map(row => ({ name: row.name, imageBytes: row.assets.map(a => a.bytes.length) })) };
  } catch (error) {
    await target.screenshot({ path: "output/playwright/pwa-directory-failure.png" });
    throw new Error(step + ": " + error.message + "\n" + (await target.locator("body").innerText()).slice(-2200));
  } finally { await context.close(); }
}
