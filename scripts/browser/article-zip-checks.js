// P2b 产品入口与原生浏览器存储往返；OPFS 选择器替身不是系统目录授权证据。
// Playwright CLI run-code --filename；在未发生 HMR 的独立 Vite 实例上运行。
// prettier-ignore
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ acceptDownloads: true });
  const target = await context.newPage();
  const checks = [], errors = [], assetRequests = [];
  const ensure = (value, message) => { if (!value) throw new Error(message); };
  let step = "start";
  const wait = async (predicate, arg = null) => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await target.evaluate(predicate, arg)) return;
      await target.waitForTimeout(40);
    }
    throw new Error("状态等待超时: " + predicate.toString());
  };
  target.on("pageerror", error => errors.push(error.message));
  target.on("request", request => { if (/\/asset\//.test(request.url())) assetRequests.push(request.url()); });
  const menu = async name => {
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.getByRole("menuitem", { name, exact: true }).click();
  };
  const importFile = async (name, mimeType, bytes, zip = false) => {
    const choosing = target.waitForEvent("filechooser");
    await menu(zip ? "导入文章包（.zip）…" : "导入 Markdown 为新文章…");
    await (await choosing).setFiles({ name, mimeType, buffer: Buffer.from(bytes) });
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await wait(() => !document.body.textContent.includes("正在提交新文章"));
  };
  const exportZip = async name => {
    const downloading = target.waitForEvent("download");
    await menu("导出当前文章包（.zip）");
    const download = await downloading;
    ensure(download.suggestedFilename().endsWith(".zip"), "下载扩展名错误");
    await download.saveAs("output/playwright/" + name);
    const stream = await download.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    return [...Buffer.concat(chunks)];
  };
  const inspectZip = bytes => target.evaluate(async bytes => {
    const { decodeArticleZip } = await import("/src/utils/articleZip/codec.ts");
    const result = decodeArticleZip(new Uint8Array(bytes));
    return { root: result.root, entries: result.entries.map(e => ({ path: e.path, bytes: [...e.bytes] })) };
  }, bytes);
  const snapshot = mode => target.evaluate(async mode => {
    const body = (await import("/src/store/editorStore.ts")).useEditorStore.getState().markdown;
    if (mode === "browser") {
      const state = (await import("/src/store/historyStore.ts")).useHistoryStore.getState();
      const assets = (await import("/src/store/historyDb.ts")).getHistoryAssets(state.activeId);
      return { id: state.activeId, body, source: state.history.find(e => e.id === state.activeId).markdown, assets: await Promise.all(assets.map(async a => ({ path: a.path, bytes: [...new Uint8Array(await a.bytes.arrayBuffer())] }))) };
    }
    const state = (await import("/src/store/fileStore.ts")).useFileStore.getState();
    const root = await window.showDirectoryPicker();
    const folder = await root.getDirectoryHandle(state.currentFile.path.split("/")[0]);
    const owner = JSON.parse(await (await (await folder.getFileHandle(".radishink-owner.json")).getFile()).text());
    const assetFolder = await folder.getDirectoryHandle("asset");
    const assets = [];
    for await (const handle of assetFolder.values()) assets.push({ path: "asset/" + handle.name, bytes: [...new Uint8Array(await (await handle.getFile()).arrayBuffer())] });
    return { id: owner.articleId, body, source: state.lastSavedContent, assets };
  }, mode);
  const sameAssets = (actual, expected) => ensure(JSON.stringify([...actual].sort((a,b) => a.path.localeCompare(b.path))) === JSON.stringify([...expected].sort((a,b) => a.path.localeCompare(b.path))), "资源路径或原字节发生变化");
  try {
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("radishink-p2b-zip-synthetic", { create: true });
    });
    await target.goto(origin);
    await target.locator(".cm-content").waitFor();
    await wait(async () => !!(await import("/src/store/historyStore.ts")).useHistoryStore.getState().activeId);
    step = "Markdown import, paste and immediate export";
    const source = "---\ncustomFlag: keep-p2b\ntitle: ZIP 合成文章\ntheme: default\n---\n\n# 合成正文\n原始段落 🥕\n";
    await importFile("合成原文.md", "text/markdown", Buffer.from(source));
    const originalId = (await snapshot("browser")).id;
    const png = await target.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "rgba(30,100,70,0.5)"; ctx.fillRect(0,0,2,2);
      return canvas.toDataURL().split(",")[1];
    });
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.evaluate(base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], "透明图.png", { type: "image/png" }));
      document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
    }, png);
    await wait(() => document.querySelector(".cm-content")?.textContent.includes("asset/image-"));
    const body = await target.locator(".cm-content").innerText();
    const bytes1 = await exportZip("p2b-browser.zip");
    const decoded1 = await inspectZip(bytes1);
    const main1 = new TextDecoder().decode(new Uint8Array(decoded1.entries.find(e => e.path === "index.md").bytes));
    ensure(main1.includes("customFlag: keep-p2b") && main1.includes(body), "最新正文或未知元数据未保留");
    const images = decoded1.entries.filter(e => e.path !== "index.md");
    ensure(images.length === 1 && Buffer.from(images[0].bytes).equals(Buffer.from(png, "base64")), "透明原图未保留");
    ensure(!decoded1.entries.some(e => /radishink|owner|state|css/.test(e.path)), "包内混入控制文件");
    checks.push("Markdown 导入 → 粘贴透明图片 → 立即 ZIP 下载；正文、未知元数据及原图字节通过");
    step = "browser to directory";
    await target.getByRole("button", { name: "存储模式", exact: true }).click();
    await target.getByRole("button", { name: /^本地文件夹 / }).click();
    await target.getByRole("button", { name: "关闭", exact: true }).click();
    await importFile("浏览器文章.zip", "application/zip", bytes1, true);
    await wait(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    const directory = await snapshot("directory");
    ensure(directory.id !== originalId && directory.body === body, "目录导入覆盖身份或改变正文"); sameAssets(directory.assets, images);
    await target.reload(); await target.locator(".cm-content").waitFor();
    await wait(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    const reopened = await snapshot("directory"); ensure(reopened.body === body, "目录重开正文变化"); sameAssets(reopened.assets, images);
    const bytes2 = await exportZip("p2b-directory.zip");
    checks.push("浏览器 ZIP → 目录新身份导入 → 刷新预览 → 目录 ZIP 下载通过");
    step = "directory to browser";
    await target.getByRole("button", { name: "存储模式", exact: true }).click();
    await target.getByRole("button", { name: /^浏览器存储 / }).click();
    await target.getByRole("button", { name: "关闭", exact: true }).click();
    await importFile("目录文章.zip", "application/zip", bytes2, true);
    await target.reload(); await target.locator(".cm-content").waitFor();
    await wait(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 2; });
    const roundtrip = await snapshot("browser");
    ensure(roundtrip.id !== originalId && roundtrip.id !== directory.id, "往返未生成新身份");
    ensure(roundtrip.body === body && roundtrip.source.includes("customFlag: keep-p2b"), "跨存储正文或元数据变化"); sameAssets(roundtrip.assets, images);
    await target.screenshot({ path: "output/playwright/p2b-cross-storage.png" });
    checks.push("目录 ZIP → 浏览器同名消歧导入 → 刷新；逐字正文和逐字节资源通过");
    step = "missing image rejection";
    await target.locator(".cm-content").fill(body + "\n![缺图](asset/missing.png)");
    let unexpectedDownload = false; const onDownload = () => { unexpectedDownload = true; }; target.on("download", onDownload);
    await menu("导出当前文章包（.zip）");
    await target.getByText(/本地资源缺失或路径不支持：asset\/missing.png/).waitFor();
    ensure(!unexpectedDownload, "缺图仍发起下载"); target.off("download", onDownload);
    checks.push("缺图默认停止 ZIP 导出，保留正文通过");
    step = "malicious archive rejection";
    const bad = await target.evaluate(async () => {
      const { zipSync, strToU8 } = await import("/node_modules/.vite/deps/fflate.js");
      return [...zipSync({ "r/index.md": strToU8("# evil"), "r/../escape": strToU8("bad") })];
    });
    const before = await snapshot("browser");
    const choosing = target.waitForEvent("filechooser"); await menu("导入文章包（.zip）…");
    await (await choosing).setFiles({ name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from(bad) });
    await target.getByText(/导入失败：.*非法文章路径/).waitFor();
    ensure((await snapshot("browser")).id === before.id, "非法包切换了旧稿");
    checks.push("真实 Worker 拒绝穿越 ZIP，旧稿保持通过");
    ensure(errors.length === 0, "页面错误: " + errors.join(" | "));
    ensure(assetRequests.length === 0, "错误网络资源请求: " + assetRequests.join(" | "));
    return { checks, errors, assetRequests, downloadBytes: [bytes1.length, bytes2.length] };
  } catch (error) {
    await target.screenshot({ path: "output/playwright/p2b-zip-failure.png" });
    throw new Error(step + ": " + error.message + "\n" + (await target.locator("body").innerText()).slice(-3500));
  } finally { await context.close(); }
}
