// Playwright CLI: run-code --filename scripts/render-web-brand-assets.js
// Start the local Web server and open its root URL in an isolated browser first.
async function renderWebBrandAssets(page) {
  const base = new URL(page.url());
  if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("Open the local Web server before rendering brand assets.");
  }
  const tab = await page.context().newPage();
  try {
    for (const [size, destination, maskable] of [
      [512, "pwa/icon-512.png", false],
      [192, "pwa/icon-192.png", false],
      [64, "favicon-dark.png", false],
      [512, "pwa/icon-maskable-512.png", true],
    ]) {
      await tab.setViewportSize({ width: size, height: size });
      await tab.goto(new URL("favicon-dark.svg", base).href);
      await tab.locator("svg").evaluate(
        (svg, { size, maskable }) => {
          svg.setAttribute("width", String(size));
          svg.setAttribute("height", String(size));
          if (maskable) {
            const background = svg.querySelector("rect");
            for (const [name, value] of Object.entries({
              x: 0,
              y: 0,
              width: 512,
              height: 512,
              rx: 0,
            })) {
              background.setAttribute(name, String(value));
            }
          }
        },
        { size, maskable },
      );
      await tab.locator("svg").screenshot({
        path: `apps/web/public/${destination}`,
        omitBackground: true,
        scale: "css",
      });
    }
  } finally {
    await tab.close();
  }
  return { generated: 4 };
}
