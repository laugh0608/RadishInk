import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync("public/information-redirect.js", "utf8");

describe("旧信息页 URL 兼容", () => {
  it.each([
    [
      "about",
      "https://example.test/about.html",
      "https://example.test/#radishink/about",
    ],
    [
      "help",
      "https://example.test/help.html",
      "https://example.test/#radishink/help",
    ],
    [
      "help",
      "https://example.test/ink/help.html?keep=1#syntax",
      "https://example.test/ink/?keep=1#radishink/help/syntax",
    ],
    [
      "about",
      "https://example.test/ink/about.html#syntax",
      "https://example.test/ink/#radishink/about",
    ],
  ])("%s 在原站点与路径内替换当前 URL", (page, href, expected) => {
    const replace = vi.fn();
    const html = readFileSync(`public/${page}.html`, "utf8");
    expect(html).toContain(`data-information-page="${page}"`);
    expect(html).toContain('src="information-redirect.js"');
    runInNewContext(script, {
      URL,
      document: { body: { dataset: { informationPage: page } } },
      window: { location: { href, replace } },
    });
    expect(replace).toHaveBeenCalledExactlyOnceWith(expected);
  });
});
