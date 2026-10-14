// 新安装、新建和单文件导入的产品入口验证；仅使用隔离上下文与合成正文。
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

  const context = await page.context().browser().newContext({ acceptDownloads: true, hasTouch: true });
  const checks = [];
  let target;
  try {
    target = await context.newPage();
    await target.goto(new URL("/", page.url()).href);
    await target.getByRole("heading", { name: "文章 1 / 30", exact: true }).waitFor();
    await target.locator("body").ariaSnapshot();
    if (await target.getByRole("dialog").count()) throw new Error("新库不应要求迁移旧库");
    await target.getByRole("button", { name: "新建文章", exact: true }).click();
    await target.getByRole("heading", { name: "文章 2 / 30", exact: true }).waitFor();
    await target.locator(".cm-content").fill("# 新文章的最新正文\n");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await waitForAsync(target, async () => (await import("/src/store/historyStore.ts")).useHistoryStore.getState().history.some(row => row.markdown.includes("新文章的最新正文")));
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.locator("body").ariaSnapshot();
    const chooserEvent = target.waitForEvent("filechooser");
    await target.getByRole("menuitem", { name: "导入 Markdown 为新文章…", exact: true }).click();
    const chooser = await chooserEvent;
    await chooser.setFiles({ name: "synthetic-import.md", mimeType: "text/markdown", buffer: Buffer.from("---\ncustomFlag: retained\n---\n\n# 合成导入正文\n") });
    await target.getByRole("heading", { name: "文章 3 / 30", exact: true }).waitFor();
    await target.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("合成导入正文"));
    await target.reload(); await target.locator(".cm-content").waitFor();
    if (!(await target.locator(".cm-content").innerText()).includes("合成导入正文")) throw new Error("导入后刷新未恢复");
    const raw = await target.evaluate(async () => {
      const { openBrowserArticleDatabase } = await import("/src/storage/articles/browserArticleDatabase.ts");
      const db = await openBrowserArticleDatabase("wemd-history"); try { return (await db.list()).map(row => row.article.markdown); } finally { db.close(); }
    });
    if (raw.length !== 3 || !raw.some(text => text.includes("customFlag: retained")) || !raw.some(text => text.includes("新文章的最新正文"))) throw new Error("导入丢失元数据或覆盖旧文");
    checks.push("新库直接初始化 v3；新建、快捷键保存、实际文件选择器导入为新文章、刷新保留旧文与未知元数据");
    await target.setViewportSize({ width: 390, height: 844 });
    await target.locator('.app[data-layout-mode="mobile"]').waitFor();
    await target.locator("body").ariaSnapshot();
    await target.screenshot({ path: "output/playwright/p2a-mobile-import.png", fullPage: true, animations: "disabled" });
    const editorBounds = await target.locator(".editor-pane").boundingBox();
    if (!editorBounds || editorBounds.x < 0 || editorBounds.x + editorBounds.width > 391) throw new Error("移动编辑区被裁切");
    checks.push("390px 触屏模拟切换移动布局，导入后编辑区完整可见（非真机）");
    return { checks };
  } catch (error) { throw new Error(String(error) + "\n" + (await target.locator("body").innerText())); } finally { await context.close(); }
}
