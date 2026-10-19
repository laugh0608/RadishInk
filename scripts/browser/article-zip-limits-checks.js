// P2b Worker 边界与桌面性能；合成数据，不代表手机真机内存保证。
// prettier-ignore
async (page) => {
  const context = await page.context().browser().newContext({ acceptDownloads: true });
  const target = await context.newPage();
  const errors = []; target.on("pageerror", error => errors.push(error.message));
  try {
    await target.goto(new URL(page.url()).origin);
    await target.locator(".cm-content").waitFor();
    const result = await target.evaluate(async () => {
      const { buildArticleZip, readArticleZip } = await import("/src/utils/articleZip/transfer.ts");
      const { encodeArticleZip, decodeArticleZip } = await import("/src/utils/articleZip/codec.ts");
      const { runZipWorker } = await import("/src/utils/articleZip/client.ts");
      const checks = [];
      const ensure = (value, message) => { if (!value) throw new Error(message); };
      const controller = new AbortController();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1536;
      const ctx = canvas.getContext("2d"); const pixels = ctx.createImageData(1536, 1536);
      let seed = 17;
      for (let i = 0; i < pixels.data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i] = seed >>> 24; }
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      canvas.width = canvas.height = 1;
      ensure(blob.size <= 10 * 1024 * 1024, "性能样本超过单图限制");
      const assets = Array.from({ length: 6 }, (_, index) => ({ path: `asset/noise-${index}.png`, bytes: blob }));
      let ticks = 0; const timer = setInterval(() => ticks++, 16);
      const started = performance.now();
      const packed = await buildArticleZip("高熵合成图片", "synthetic-large", "# 大包\n![图](asset/noise-0.png)", assets, controller.signal, () => {});
      const packedMs = Math.round(performance.now() - started);
      const unpackStart = performance.now();
      const unpacked = await readArticleZip(new File([packed.bytes], "large.zip"), controller.signal, () => {});
      const unpackMs = Math.round(performance.now() - unpackStart);
      clearInterval(timer);
      ensure(unpacked.assets.length === 6 && unpacked.assets.every(a => a.bytes.size === blob.size), "大包资源不完整");
      const hash = async blob => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].join(",");
      const expected = await hash(blob);
      for (const asset of unpacked.assets) ensure(await hash(asset.bytes) === expected, "高熵原图字节改变");
      ensure(ticks > 0, "处理阻塞全部主线程计时");
      checks.push({ large: { imageBytes: blob.size, assetCount: 6, zipBytes: packed.bytes.length, packMs: packedMs, unpackMs, mainThreadTicks: ticks } });
      const cancel = new AbortController();
      const pending = runZipWorker("decode", packed.bytes, cancel.signal, () => {});
      cancel.abort();
      let canceled = false; try { await pending; } catch (error) { canceled = /取消/.test(error.message); }
      ensure(canceled, "真实 Worker 取消没有拒绝结果");
      checks.push("真实 Worker 显式取消后不交付结果");
      const gif = new Uint8Array([
        ...new TextEncoder().encode("GIF89a"),1,0,1,0,128,0,0,255,0,0,0,0,255,
        33,255,11,...new TextEncoder().encode("NETSCAPE2.0"),3,1,0,0,0,
        33,249,4,0,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,
        33,249,4,0,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59
      ]);
      const source = "---\ncustom: 保留\n---\n# 中文空格文件名\n![动图](<asset/动画 原图.gif>)\n![外链](https://example.invalid/picture.png)";
      const small = encodeArticleZip({ root: "中文 文章", entries: [
        { path: "index.md", bytes: new TextEncoder().encode(source) },
        { path: "asset/动画 原图.gif", bytes: gif },
        { path: "asset/未引用.gif", bytes: gif }
      ] });
      const imported = await readArticleZip(new File([small], "中文 文章.zip"), controller.signal, () => {});
      ensure(imported.external && imported.assets.length === 2, "外链提示或未引用资源遗漏");
      ensure([...new Uint8Array(await imported.assets[0].bytes.arrayBuffer())].join(",") === [...gif].join(","), "GIF 动画帧字节变化");
      const empty = await buildArticleZip("空图片", "empty", "# 无图片", [], controller.signal, () => {});
      ensure(new TextDecoder().decode(empty.bytes).includes("/asset/"), "空包缺少 asset 目录");
      ensure(decodeArticleZip(empty.bytes).entries.length === 1, "空包结构错误");
      checks.push("空 asset 目录、中文/空格名、两帧 GIF 原字节、未引用资源和外链提示通过");
      return { checks, unicodeZip: [...small] };
    });
    const selecting = target.waitForEvent("filechooser");
    await target.getByRole("button", { name: "文件", exact: true }).click();
    await target.getByRole("menuitem", { name: "导入文章包（.zip）…", exact: true }).click();
    await (await selecting).setFiles({ name: "中文资源.zip", mimeType: "application/zip", buffer: Buffer.from(result.unicodeZip) });
    await target.getByText("已导入为新文章", { exact: true }).waitFor();
    await target.locator('.preview-content img[src^="blob:"]').waitFor();
    await target.waitForFunction(() => { const img = document.querySelector('.preview-content img[src^="blob:"]'); return img?.complete && img.naturalWidth === 1; });
    await target.screenshot({ path: "output/playwright/p2b-unicode-gif.png" });
    result.checks.push("中文与空格 GIF 路径在真实导入后的预览解码通过");
    if (errors.length) throw new Error(errors.join(" | "));
    return { checks: result.checks, errors };
  } finally { await context.close(); }
}
