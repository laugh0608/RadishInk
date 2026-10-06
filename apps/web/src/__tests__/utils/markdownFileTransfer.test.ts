import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readMarkdownFile,
  downloadMarkdownFile,
  MAX_MARKDOWN_FILE_BYTES,
} from "../../utils/markdownFileTransfer";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
} from "../../utils/markdownFileMeta";
import { normalizeMarkdownFileName } from "../../utils/fileName";

const file = (name: string, bytes: Uint8Array) =>
  ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer }) as File;
const utf8 = (name: string, text: string) =>
  file(name, new TextEncoder().encode(text));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Markdown 文件边界", () => {
  it("UTF-8 BOM、CRLF、未知嵌套元数据、中文 emoji 和正文源文本往返", async () => {
    const source =
      '\uFEFF---\r\nauthor:\r\n  title: 嵌套标题\r\n  theme: 外部主题\r\ntags: [中文, emoji]\r\n# 注释\r\n---\r\n\r\n    缩进代码 🥕\r\n\r\n$E=mc^2$\r\n```mermaid\r\ngraph LR; A-->B\r\n```\r\n<img src=x onerror="window.marker=1">\r\n';
    const result = await readMarkdownFile(utf8("交换.MARKDOWN", source));
    expect(result.title).toBe("交换");
    expect(result.parsed.theme).toBe("default");
    expect(result.parsed.body.startsWith("    缩进代码 🥕")).toBe(true);
    const output = applyMarkdownFileMeta(result.source, {
      ...result.parsed,
      title: result.title,
    });
    expect(output).toContain(
      "author:\n  title: 嵌套标题\n  theme: 外部主题\ntags: [中文, emoji]\n# 注释",
    );
    expect(parseMarkdownFileContent(output).body).toBe(result.parsed.body);
    expect(applyMarkdownFileMeta(output, { body: result.parsed.body })).toBe(
      output,
    );
  });

  it("接受空文件、大小写扩展名及恰好 5 MiB", async () => {
    expect((await readMarkdownFile(utf8("empty.MD", ""))).parsed.body).toBe("");
    expect(
      (
        await readMarkdownFile(
          utf8("limit.md", "a".repeat(MAX_MARKDOWN_FILE_BYTES)),
        )
      ).source.length,
    ).toBe(MAX_MARKDOWN_FILE_BYTES);
  });

  it.each([
    ["bad.txt", new Uint8Array([65]), "请选择"],
    ["bad.md", new Uint8Array([0xff, 0xfe]), "UTF-8"],
    ["bad.md", new Uint8Array([65, 0, 66]), "控制字符"],
  ])("拒绝非法文件 %s %s", async (name, bytes, message) => {
    await expect(readMarkdownFile(file(name, bytes))).rejects.toThrow(message);
  });

  it("超限先拒绝，不读取字节；读取错误向上传递", async () => {
    const arrayBuffer = vi.fn();
    await expect(
      readMarkdownFile({
        name: "big.md",
        size: MAX_MARKDOWN_FILE_BYTES + 1,
        arrayBuffer,
      } as unknown as File),
    ).rejects.toThrow("5 MiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
    await expect(
      readMarkdownFile({
        name: "bad.md",
        size: 1,
        arrayBuffer: () => Promise.reject(new Error("读取失败")),
      } as unknown as File),
    ).rejects.toThrow("读取失败");
  });

  it("复杂已知字段及未知字段保持原文，正文多余空行与缩进不丢失", () => {
    const source =
      "---\ntitle: |\n  多行标题\ncustom: {theme: a}\n---\n\n\n    code\n";
    const parsed = parseMarkdownFileContent(source);
    const output = applyMarkdownFileMeta(source, {
      title: "文件标题",
      theme: "default",
      body: parsed.body,
    });
    expect(output).toContain("title: |\n  多行标题\ncustom: {theme: a}");
    expect(parseMarkdownFileContent(output).body).toBe("\n    code\n");
  });

  it("标题中的换行正确编码，文件名清理路径和控制字符", () => {
    const title = 'a/b\\c\n"d"';
    expect(
      parseMarkdownFileContent(applyMarkdownFileMeta("", { title })).title,
    ).toBe(title);
    expect(normalizeMarkdownFileName("../a:b\u0000.MARKDOWN")).toBe("_a_b_.md");
    expect(
      parseMarkdownFileContent(
        applyMarkdownFileMeta('---\ntitle: ""\n---\n\n', { title: "源文件名" }),
      ).title,
    ).toBe("源文件名");
  });

  it("发起真实 a 下载并延迟释放 URL，正文不添加结尾换行", () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => "blob:test");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("最新.md");
        expect(document.body.contains(this)).toBe(true);
      });
    downloadMarkdownFile("最新", "正文");
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
