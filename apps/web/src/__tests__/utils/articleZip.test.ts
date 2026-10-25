import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { zipSync, strToU8 } from "fflate";
import {
  decodeArticleZip,
  encodeArticleZip,
  crc32,
  ZIP_LIMITS,
} from "../../utils/articleZip/codec";
import { inspectPackageReferences } from "../../utils/articleZip/transfer";

const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ6AloAAADaQGFqnByCwAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const text = strToU8(
  "---\nextra: 保留\n---\n# 中文文章\n![透明](asset/图 片.png)\n",
);
const make = (
  entries: Record<string, Uint8Array> = {
    "文章/index.md": text,
    "文章/asset/图 片.png": png,
  },
  level: 0 | 6 = 0,
) => zipSync(entries, { level });
function mutate(
  bytes: Uint8Array,
  change: (view: DataView, central: number) => void,
) {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const end = copy.length - 22;
  change(view, view.getUint32(end + 16, true));
  return copy;
}
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
});
afterEach(() => vi.unstubAllGlobals());

describe("文章 ZIP 的边界与可回读性", () => {
  it.each([0, 6] as const)(
    "STORE/DEFLATE %s 保留 UTF-8 正文和每个资源的原字节",
    (level) => {
      const value = decodeArticleZip(make(undefined, level));
      expect(value.root).toBe("文章");
      expect(
        value.entries.map((e) => ({
          path: e.path,
          bytes: Array.from(e.bytes),
        })),
      ).toEqual([
        { path: "index.md", bytes: Array.from(text) },
        { path: "asset/图 片.png", bytes: Array.from(png) },
      ]);
      expect(decodeArticleZip(encodeArticleZip(value))).toEqual(value);
    },
  );
  it("空资源导出含显式 asset/；未引用图片仍在包内", () => {
    const bytes = encodeArticleZip({
      root: "空文章",
      entries: [{ path: "index.md", bytes: strToU8("# 空") }],
    });
    expect(new TextDecoder().decode(bytes)).toContain("空文章/asset/");
    const value = decodeArticleZip(
      make({ "r/index.md": strToU8("# 无引用"), "r/asset/a.png": png }),
    );
    expect(value.entries).toHaveLength(2);
  });
  it.each([
    "../escape",
    "/absolute",
    "C:/a",
    "r/../x",
    "r/asset/../evil.png",
    "r/asset/a\\b.png",
    "r/asset/a%2fb.png",
    "r/asset/NUL.png",
    "r/asset/a\u0000.png",
    "r/asset/e\u0301.png",
    "r/.radishink/state.json",
    "r/asset/script.js",
    "r/extra.md",
    "other/index.md",
  ])("拒绝路径或附件 %s", (path) => {
    expect(() =>
      decodeArticleZip(make({ "r/index.md": text, [path]: png })),
    ).toThrow();
  });
  it("拒绝大小写冲突、缺少正文、多文章与伪图片", () => {
    expect(() =>
      decodeArticleZip(
        make({
          "r/index.md": text,
          "r/asset/A.png": png,
          "r/asset/a.png": png,
        }),
      ),
    ).toThrow(/冲突/);
    expect(() => decodeArticleZip(make({ "r/asset/a.png": png }))).toThrow(
      /index.md/,
    );
    expect(() =>
      decodeArticleZip(make({ "r/index.md": text, "r/asset/a.jpg": png })),
    ).toThrow(/扩展名/);
    expect(() =>
      decodeArticleZip(make({ "r/index.md": text, "r/asset/a.png": text })),
    ).toThrow(/图片/);
  });
  it("CRC、截断和本地头伪造不能解包成功", () => {
    const bytes = make();
    expect(() => decodeArticleZip(bytes.slice(0, -1))).toThrow();
    expect(() =>
      decodeArticleZip(mutate(bytes, (v, c) => v.setUint32(c + 16, 42, true))),
    ).toThrow(/本地头/);
    expect(() =>
      decodeArticleZip(
        mutate(bytes, (v, c) => {
          v.setUint32(c + 16, 42, true);
          v.setUint32(14, 42, true);
        }),
      ),
    ).toThrow(/CRC/);
    expect(() =>
      decodeArticleZip(mutate(bytes, (v) => v.setUint32(18, 1, true))),
    ).toThrow(/本地头/);
  });
  it("拒绝加密、描述符、ZIP64、符号链接和重叠条目", () => {
    const bytes = make();
    for (const flags of [1, 8])
      expect(() =>
        decodeArticleZip(
          mutate(bytes, (v, c) => v.setUint16(c + 8, flags, true)),
        ),
      ).toThrow();
    expect(() =>
      decodeArticleZip(
        mutate(bytes, (v, c) => v.setUint32(c + 38, 0xa000 << 16, true)),
      ),
    ).toThrow(/符号链接/);
    expect(() =>
      decodeArticleZip(
        mutate(bytes, (v) => v.setUint32(bytes.length - 6, 0xffffffff, true)),
      ),
    ).toThrow(/ZIP64/);
    expect(() =>
      decodeArticleZip(mutate(bytes, (v, c) => v.setUint32(c + 42, 1, true))),
    ).toThrow();
  });
  it("声明过大和实际膨胀超出声明都拒绝", () => {
    const bytes = make(
      { "r/index.md": new Uint8Array(1024 * 1024).fill(65) },
      6,
    );
    const bomb = mutate(bytes, (v, c) => {
      v.setUint32(c + 24, 1, true);
      v.setUint32(22, 1, true);
    });
    expect(() => decodeArticleZip(bomb)).toThrow(/实际展开/);
    expect(() =>
      decodeArticleZip(
        mutate(bytes, (v, c) =>
          v.setUint32(c + 24, ZIP_LIMITS.bytes + 1, true),
        ),
      ),
    ).toThrow(/超过限制/);
    expect(() =>
      decodeArticleZip(new Uint8Array(ZIP_LIMITS.bytes + 1)),
    ).toThrow(/64 MiB/);
    const entries: Record<string, Uint8Array> = { "r/index.md": text };
    for (let index = 0; index < 128; index++)
      entries[`r/asset/${index}.png`] = png;
    expect(() => decodeArticleZip(make(entries))).toThrow(/条目/);
  });
  it("中文和空格图片引用解码后与包内路径匹配，编码越界仍拒绝", () => {
    const assets = [{ path: "asset/图 片.png", bytes: new Blob([png]) }];
    expect(
      inspectPackageReferences("![图](<asset/图 片.png>)", assets),
    ).toEqual({ external: false });
    expect(() =>
      inspectPackageReferences('<img src="asset/%2e%2e%2fevil.png">', assets),
    ).toThrow();
    expect(() =>
      inspectPackageReferences(
        '<div style="background:url(asset/lost.png)"></div>',
        assets,
      ),
    ).toThrow(/CSS/);
  });
  it("CRC 标准向量", () =>
    expect(crc32(strToU8("123456789"))).toBe(0xcbf43926));
  it("Markdown、HTML 图片和本地附件都检查，外链提示、代码块不误报", () => {
    const assets = [{ path: "asset/a.png", bytes: new Blob([png]) }];
    expect(
      inspectPackageReferences(
        '![图](asset/a.png)\n<img src="asset/a.png">\n![网](https://example.invalid/a.png)\n```\n![code](missing)\n```',
        assets,
      ),
    ).toEqual({ external: true });
    expect(() =>
      inspectPackageReferences('<img src="asset/lost.png">', assets),
    ).toThrow(/lost.png/);
    expect(() => inspectPackageReferences("[附件](other.pdf)", assets)).toThrow(
      /other.pdf/,
    );
    expect(() =>
      inspectPackageReferences(
        '<img src="asset/a.png" srcset="asset/lost.png 2x">',
        assets,
      ),
    ).toThrow(/srcset/);
  });
});
