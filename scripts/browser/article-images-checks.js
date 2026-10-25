// 图片产品入口；独立上下文 + 合成 OPFS，目录选择器替身不是系统授权证据。
// 使用 Playwright CLI run-code --filename。
// prettier-ignore
async (page) => {
  const origin = new URL(page.url()).origin;
  const context = await page
    .context()
    .browser()
    .newContext({ acceptDownloads: true });
  const target = await context.newPage();
  const checks = [],
    errors = [],
    resourceRequests = [];
  const ensure = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (predicate, arg = null) => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await target.evaluate(predicate, arg)) return;
      await target.waitForTimeout(50);
    }
    throw new Error("图片状态等待超时：" + predicate.toString());
  };
  target.on("pageerror", (error) => errors.push(error.message));
  target.on("request", (request) => {
    if (/\/asset\//.test(request.url())) resourceRequests.push(request.url());
  });
  let step = "start";
  try {
    await context.addInitScript(() => {
      window.showDirectoryPicker = async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(
          "radishink-p2a-image-synthetic",
          { create: true },
        );
    });
    await target.goto(origin);
    await target.locator(".cm-content").waitFor();
    await wait(
      async () =>
        !!(
          await import("/src/store/historyStore.ts")
        ).useHistoryStore.getState().activeId,
    );
    const measurement = await target.evaluate(async () => {
      const { prepareImage } = await import(
        "/src/components/ArticleAssets/imagePolicy.ts"
      );
      const results = [];
      for (const [size, type] of [
        [1000, "image/png"],
        [1000, "image/jpeg"],
        [1000, "image/webp"],
        [4000, "image/png"],
      ]) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#45885e";
        ctx.fillRect(0, 0, size, size);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, type),
        );
        const start = performance.now();
        const asset = await prepareImage(
          new File([blob], "synthetic", { type }),
        );
        results.push({
          size,
          type,
          bytes: blob.size,
          decodeMs: Math.round(performance.now() - start),
          preserved: asset.bytes.size === blob.size,
        });
        canvas.width = canvas.height = 1;
      }
      // 两帧合成 GIF：原始帧数据应保留，不重编码为静态图。
      const gif = new Uint8Array([
        ...new TextEncoder().encode("GIF89a"), 1,0,1,0,128,0,0, 255,0,0, 0,0,255,
        33,255,11,...new TextEncoder().encode("NETSCAPE2.0"),3,1,0,0,0,
        33,249,4,0,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,
        33,249,4,0,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59
      ]);
      const animated = await prepareImage(new File([gif], "animated.gif", {type:"image/gif"}));
      if (String(new Uint8Array(await animated.bytes.arrayBuffer())) !== String(gif)) throw new Error("GIF 帧字节改变");
      results.push({type:"image/gif", bytes:gif.length, frames:2, preserved:true});
      return results;
    });
    checks.push({ measurement });
    const png = await target.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(40, 140, 80, 0.5)";
      ctx.fillRect(0, 0, 1, 1);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const insert = async () => {
      const choosing = target.waitForEvent("filechooser");
      await target.getByRole("button", { name: "选择图片", exact: true }).click();
      const chooser = await choosing;
      await chooser.setFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: Buffer.from(png, "base64"),
        });
      await wait(() =>
        document
          .querySelector(".cm-content")
          ?.textContent.includes("asset/image-"),
      );
      await wait(() => {
        const image = document.querySelector(
          '.preview-content img[src^="blob:"]',
        );
        return image?.complete && image.naturalWidth === 1;
      });
    };
    for (const mode of ["browser", "directory"]) {
      step = mode;
      if (mode === "directory") {
        await target
          .getByRole("button", { name: "存储模式", exact: true })
          .click();
        await target.getByRole("button", { name: /^本地文件夹 / }).click();
        await target.getByRole("button", { name: "关闭", exact: true }).click();
        await target
          .getByRole("button", { name: "新建文章", exact: true })
          .click();
        await wait(
          async () =>
            !!(await import("/src/store/fileStore.ts")).useFileStore.getState()
              .currentFile?.articlePackage,
        );
      }
      await target.locator(".cm-content").fill("# 合成图片正文\n\n");
      await target.locator(".cm-content").press("ControlOrMeta+End");
      await insert();
      await target.locator(".cm-content").press("ControlOrMeta+s");
      await wait(
        async (mode) =>
          mode === "browser"
            ? (await import("/src/store/historyStore.ts")).useHistoryStore
                .getState()
                .history.some((row) => row.markdown.includes("asset/image-"))
            : (await import("/src/store/fileStore.ts")).useFileStore
                .getState()
                .lastSavedContent.includes("asset/image-"),
        mode,
      );
      const oldUrl = await target
        .locator('.preview-content img[src^="blob:"]')
        .getAttribute("src");
      const saved = await target.evaluate(async (mode) => {
        if (mode === "browser") {
          const { useHistoryStore } = await import(
            "/src/store/historyStore.ts"
          );
          const { getHistoryAssets } = await import("/src/store/historyDb.ts");
          const state = useHistoryStore.getState();
          const asset = getHistoryAssets(state.activeId)[0];
          return {
            path: asset.path,
            bytes: Array.from(new Uint8Array(await asset.bytes.arrayBuffer())),
          };
        }
        const path = (
          await import("/src/store/fileStore.ts")
        ).useFileStore.getState().currentFile.path;
        const root = await window.showDirectoryPicker();
        const folder = await root.getDirectoryHandle(path.split("/")[0]);
        const assets = await folder.getDirectoryHandle("asset");
        for await (const handle of assets.values())
          return {
            path: "asset/" + handle.name,
            bytes: Array.from(
              new Uint8Array(await (await handle.getFile()).arrayBuffer()),
            ),
          };
      }, mode);
      ensure(
        Buffer.from(saved.bytes).equals(Buffer.from(png, "base64")),
        mode + " 图片字节改变",
      );
      await target.reload();
      await target.locator(".cm-content").waitFor();
      await wait(() => {
        const image = document.querySelector(
          '.preview-content img[src^="blob:"]',
        );
        return image?.complete && image.naturalWidth === 1;
      });
      ensure(
        (await target
          .locator('.preview-content img[src^="blob:"]')
          .getAttribute("src")) !== oldUrl,
        "刷新复用了旧临时 URL",
      );
      const doc = await target.locator(".cm-content").innerText();
      ensure(
        doc.includes(saved.path) && !doc.includes("blob:"),
        "正文不是相对资源路径",
      );
      await target
        .getByRole("button", { name: "复制 HTML", exact: true })
        .click();
      await target.getByText(/本次未复制/).waitFor();
      await target.screenshot({
        path: "output/playwright/p2a-images-" + mode + ".png",
      });
      checks.push(
        mode + " 选图、原始字节、相对引用、保存刷新、预览及复制阻断通过",
      );
    }
    step = "paste";
    await target.locator(".cm-content").fill("混合粘贴起点\n");
    await target.locator(".cm-content").press("ControlOrMeta+End");
    await target.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "pasted.png", { type: "image/png" }),
      );
      transfer.setData("text/plain", "保留混合文本");
      document
        .querySelector(".cm-content")
        .dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
    }, png);
    await wait(() =>
      document
        .querySelector(".cm-content")
        ?.textContent.includes("asset/image-"),
    );
    ensure(
      (await target.locator(".cm-content").innerText()).includes(
        "保留混合文本",
      ),
      "图片粘贴吞掉纯文本",
    );
    checks.push("剪贴板图片与同次纯文本均保留");
    ensure(
      resourceRequests.length === 0,
      "相对资源泄漏为 HTTP 请求：" + resourceRequests,
    );
    ensure(errors.length === 0, "页面异常：" + errors);
    return { checks, errors, resourceRequests };
  } catch (error) {
    throw new Error(JSON.stringify({ step, checks, errors, error: String(error), body: await target.locator("body").innerText() }));
  } finally {
    await context.close();
  }
}
