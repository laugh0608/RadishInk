import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "@wemd/core";
import { sanitizeRenderedHtml } from "../../utils/sanitizeRenderedHtml";

describe("rendered Markdown HTML security boundary", () => {
  it.each([
    '<img src="data:image/png;base64,broken" onerror="window.reviewProbe=1">',
    '<svg onload="window.reviewProbe=1"><script>window.reviewProbe=1</script></svg>',
    '<a href="java&#x73;cript:window.reviewProbe=1">link</a>',
    '<iframe srcdoc="<script>window.reviewProbe=1</script>"></iframe>',
    '<math><mtext><img src=x onerror="window.reviewProbe=1"></mtext></math>',
    '<svg><a><animate attributeName="href" values="javascript:window.reviewProbe=1"></animate>link</a></svg>',
  ])("removes active content: %s", (source) => {
    const parser = createMarkdownParser();
    const host = document.createElement("div");
    host.innerHTML = sanitizeRenderedHtml(parser.render(source));
    expect(host.querySelector("script, iframe, animate")).toBeNull();
    for (const element of host.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on|^srcdoc$/i);
        expect(attribute.value).not.toMatch(/javascript:/i);
      }
    }
  });

  it("removes document controls while keeping scoped formatting and metadata", () => {
    const html = sanitizeRenderedHtml(
      '<style>body{display:none}</style><form><input autofocus></form><p id="summary" class="lead" data-wemd-source-start="0" style="color:red">正文</p>',
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("style, form, input")).toBeNull();
    expect(
      host
        .querySelector("#summary.lead")
        ?.getAttribute("data-wemd-source-start"),
    ).toBe("0");
    expect(host.querySelector("p")?.style.color).toBe("red");
  });

  it("preserves formulas, tables, local images, SVG paths, links and Mermaid source", () => {
    const parser = createMarkdownParser({ includeSourcePosition: true });
    const source =
      '# 标题\n\n$x^2$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![图](./images/writing.svg)\n\n[链接](https://example.com)\n\n```mermaid\ngraph LR\n A --> B\n```\n\n<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
    const host = document.createElement("div");
    host.innerHTML = sanitizeRenderedHtml(parser.render(source));
    expect(host.querySelector(".katex math mi")?.textContent).toBe("x");
    expect(host.querySelector(".katex-html")).not.toBeNull();
    expect(host.querySelector("table td")?.textContent).toBe("1");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "./images/writing.svg",
    );
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(host.querySelector("pre.mermaid")?.textContent).toContain("A --> B");
    expect(host.querySelector("svg path")?.getAttribute("d")).toBe(
      "M0 0L10 10",
    );
    expect(host.querySelector("[data-wemd-source-start]")).not.toBeNull();
  });
});
