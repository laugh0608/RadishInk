import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeTextLineHeightForWechat } from "../../services/wechatTextLineHeight";
import { normalizeCopyContainer } from "../../services/wechatCopyNormalizer";

const fixture = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = `<section style="font-size:16px;line-height:1.8">${html}</section>`;
  document.body.appendChild(container);
  return container;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("公众号文字行高", () => {
  it("修正上下标与脚注的零行高，保留字号、基线位置和正文间距", () => {
    const container = fixture(`
      <p style="font-size:16px;line-height:1.8;margin:16px 0">
        H<sub style="font-size:12px;line-height:0;vertical-align:sub">2</sub>O
        E=mc<sup style="font-size:12px;line-height:0;vertical-align:super">2</sup>
        参考<sup class="footnote-ref" style="font-size:12px;line-height:0">[1]</sup>
      </p>`);
    normalizeCopyContainer(container);
    const p = container.querySelector("p")!;
    expect(p.style.lineHeight).toBe("28.8px");
    expect(p.style.margin).toBe("16px 0px");
    for (const script of container.querySelectorAll<HTMLElement>("sup,sub")) {
      expect(script.style.lineHeight).toBe("12px");
      expect(script.style.fontSize).toBe("12px");
    }
    expect(container.querySelector("sub")!.style.verticalAlign).toBe("sub");
    expect(container.querySelector("sup")!.style.verticalAlign).toBe("super");
  });

  it("不把合理的上下标行高缩小，也不覆盖其显式优先级", () => {
    const container = fixture(
      '<sup style="font-size:12px;line-height:18px!important">[1]</sup>',
    );
    materializeTextLineHeightForWechat(container);
    const sup = container.querySelector("sup")!;
    expect(sup.style.lineHeight).toBe("18px");
    expect(sup.style.getPropertyPriority("line-height")).toBe("important");
  });

  it("小数字号的上下标行高不能因取整而重新小于字号", () => {
    const container = fixture(
      '<sup style="font-size:13.3333px;line-height:0">2</sup>',
    );
    materializeTextLineHeightForWechat(container);
    const sup = container.querySelector("sup")!;
    expect(Number.parseFloat(sup.style.lineHeight)).toBeGreaterThanOrEqual(
      13.3333,
    );
    expect(sup.style.lineHeight).toBe("13.334px");
  });

  it("写入加粗、链接、代码和公式容器继承到的行高，保留根节点倍数", () => {
    const container = fixture(
      '<p><strong>加粗</strong><a>链接</a><code>代码</code><span class="inline-equation"><svg><path /></svg></span></p>',
    );
    // jsdom 无排版引擎；此处提供浏览器对继承行高的计算结果。
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          fontSize: "16px",
          lineHeight: "28.8px",
        }) as CSSStyleDeclaration,
    );
    materializeTextLineHeightForWechat(container);
    for (const inline of container.querySelectorAll<HTMLElement>(
      "strong,a,code,.inline-equation",
    )) {
      expect(inline.style.lineHeight).toBe("28.8px");
      expect(inline.style.fontSize).toBe("");
    }
    expect((container.firstElementChild as HTMLElement).style.lineHeight).toBe(
      "1.8",
    );
    expect(container.querySelector("path")!.getAttribute("style")).toBeNull();
  });

  it("在任何写入前读取继承值，避免变字号子元素错误继承父节点像素值", () => {
    const container = fixture(
      '<p style="font-size:16px;line-height:1.8">正文<strong style="font-size:24px">大字</strong></p>',
    );
    const p = container.querySelector("p")!;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (node) =>
        ({
          fontSize: node.tagName === "STRONG" ? "24px" : "16px",
          lineHeight:
            node.tagName === "STRONG" && p.style.lineHeight === "1.8"
              ? "43.2px"
              : "28.8px",
        }) as CSSStyleDeclaration,
    );
    materializeTextLineHeightForWechat(container);
    expect(p.style.lineHeight).toBe("28.8px");
    expect(container.querySelector("strong")!.style.lineHeight).toBe("43.2px");
  });

  it("不改写图片拼接、SVG 或 KaTeX 内部的布局行高", () => {
    const container = fixture(`
      <div id="image" style="font-size:16px;line-height:0"><img alt="image"></div>
      <svg><foreignObject><div style="font-size:16px;line-height:0">SVG 文本</div></foreignObject></svg>
      <span class="katex"><span style="font-size:12px;line-height:0">公式布局</span></span>
      <span class="katex-display" style="font-size:16px;line-height:0">公式布局</span>`);
    const before = container.innerHTML;
    materializeTextLineHeightForWechat(container);
    expect(container.innerHTML).toBe(before);
  });

  it("保留 normal 与普通文字的显式紧凑行高，不推测字体度量或放大全文", () => {
    const container = fixture(
      '<p id="normal" style="font-size:16px;line-height:normal">正文</p><p id="tight" style="font-size:16px;line-height:12px">紧凑文字</p>',
    );
    materializeTextLineHeightForWechat(container);
    expect(
      container.querySelector<HTMLElement>("#normal")!.style.lineHeight,
    ).toBe("normal");
    expect(
      container.querySelector<HTMLElement>("#tight")!.style.lineHeight,
    ).toBe("12px");
  });

  it("不把未解析的相对字号当成像素，并且重复执行保持稳定", () => {
    const container = fixture(
      '<sup style="font-size:.75em;line-height:0">2</sup><p style="font-size:16px;line-height:1.8">正文</p>',
    );
    materializeTextLineHeightForWechat(container);
    const once = container.innerHTML;
    materializeTextLineHeightForWechat(container);
    expect(container.innerHTML).toBe(once);
    // jsdom 返回未解析的 em；真实浏览器会计算为 px（另作浏览器验收）。
    expect(container.querySelector("sup")!.style.lineHeight).toBe("0");
    expect(container.querySelector("p")!.style.lineHeight).toBe("28.8px");
  });
});
