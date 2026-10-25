// 固定生产构建的 UI 与 Worker 验证，不使用开发模块或存储替身。
// 启动本地 preview 127.0.0.1:4173 后使用 Playwright CLI run-code --filename。
// 先运行 article-zip-checks.js 生成本地合成 ZIP。
// prettier-ignore
async (page) => {
  const context = await page.context().browser().newContext({ acceptDownloads: true, hasTouch: true });
  const target = await context.newPage(); const errors = [], workers = [];
  target.on("pageerror", error => errors.push(error.message));
  target.on("worker", worker => workers.push(worker.url()));
  try {
    await target.goto("http://127.0.0.1:4173/");
    await target.locator(".cm-content").waitFor();
    await target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src*="writing.svg"]'); return img?.complete && img.naturalWidth > 0; });
    const menu = async name => {
      await target.getByRole("button", { name: "文件", exact: true }).click();
      await target.getByRole("menuitem", { name, exact: true }).click();
    };
    const blankDownload = target.waitForEvent("download");
    await menu("导出当前文章包（.zip）");
    await (await blankDownload).saveAs("output/playwright/p2b-production-empty.zip");
    const choosing = target.waitForEvent("filechooser");
    await menu("导入文章包（.zip）…");
    await (await choosing).setFiles("/Users/luobo/Code/RadishInk/output/playwright/p2b-browser.zip");
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    const body = await target.locator(".cm-content").innerText();
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.locator(".cm-content").press("Enter");
    await target.locator(".cm-content").pressSequentially("production-latest-unsaved", { delay: 2 });
    const downloading = target.waitForEvent("download");
    await menu("导出当前文章包（.zip）");
    const downloaded = await downloading;
    await downloaded.saveAs("output/playwright/p2b-production-roundtrip.zip");
    await target.locator(".cm-content").press("ControlOrMeta+s");
    await target.getByText("刚刚保存", { exact: true }).waitFor();
    await target.reload(); await target.locator(".cm-content").waitFor();
    await target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    const recovered = await target.locator(".cm-content").innerText();
    if (!recovered.includes(body) || !recovered.includes("production-latest-unsaved")) throw new Error("生产刷新未恢复最新正文");
    await target.getByRole("button", { name: "复制 HTML", exact: true }).click();
    await target.getByText(/本次未复制.*导出文章 ZIP/).waitFor();
    await target.setViewportSize({ width: 390, height: 844 });
    await target.getByRole("button", { name: "更多功能", exact: true }).click();
    await target.getByRole("button", { name: "文件", exact: true }).click();
    const menuBox = await target.getByRole("menu").boundingBox();
    if (!menuBox || menuBox.x < 0 || menuBox.y < 0 || menuBox.x + menuBox.width > 391 || menuBox.y + menuBox.height > 845) throw new Error("移动文件菜单被裁切");
    await target.screenshot({ path: "output/playwright/p2b-production-mobile-menu.png" });
    if (errors.length) throw new Error(errors.join(" | "));
    if (!workers.some(url => /\/assets\/worker-.*\.js/.test(url))) throw new Error("未运行生产 Worker 资源");
    return { checks: ["相对部署内置示例图预览", "无本地资源 ZIP 下载", "真实文件选择 ZIP 导入及图片解码", "最新未保存输入 ZIP 导出和保存刷新", "本地图片复制明确说明 ZIP 手工交付", "390px 移动文件菜单未裁切"], workers, errors };
  } finally { await context.close(); }
}
