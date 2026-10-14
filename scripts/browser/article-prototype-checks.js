// Playwright CLI run-code --filename；先打开本地 Vite 页面，脚本只使用全新隔离上下文。
// prettier-ignore
async (page) => {
  const context = await page.context().browser().newContext();
  try {
    const isolated = await context.newPage();
    await isolated.goto(new URL("/", page.url()).href);
    return await isolated.evaluate(async () => {
      const { runNativeArticlePrototypeChecks } = await import("/src/__tests__/storage/articlePrototype.browser.ts");
      return runNativeArticlePrototypeChecks();
    });
  } finally {
    await context.close();
  }
}
