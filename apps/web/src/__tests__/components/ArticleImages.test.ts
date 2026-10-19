import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ImageInsertion } from "../../components/ArticleAssets/imageInsertion";
import {
  inspectImage,
  prepareImage,
  checkImageBatch,
  IMAGE_LIMITS,
} from "../../components/ArticleAssets/imagePolicy";
import {
  resolveArticleImages,
  assertCopyableImages,
} from "../../utils/articleImageSources";
import type { ArticleImageTarget } from "../../components/ArticleAssets/ArticleWorkspaceContext";
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ6AloAAADaQGFqnByCwAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const image = () => new File([png], "image.png", { type: "image/png" });
let views: EditorView[] = [];
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
  );
});
afterEach(() => {
  views.forEach((view) => view.destroy());
  views = [];
  vi.unstubAllGlobals();
});
function editor(append = vi.fn(async () => {})) {
  const view = new EditorView({
    state: EditorState.create({
      doc: "abcdef",
      selection: { anchor: 3 },
      extensions: [
        EditorView.updateListener.of((update) => controller?.update(update)),
      ],
    }),
  });
  views.push(view);
  const errors = vi.fn();
  const busy = vi.fn();
  const controller = new ImageInsertion(view, busy, errors);
  const target: ArticleImageTarget = {
    assets: [],
    append,
    isCurrent: () => true,
  };
  controller.begin(target);
  return { view, controller, target, errors, busy };
}
describe("图片限额与内容验证", () => {
  it("验证格式且保存原字节，不依赖文件名", async () => {
    const asset = await prepareImage(
      new File([png], "../../unsafe.svg", { type: "image/png" }),
    );
    expect(asset.path).toMatch(/^asset\/image-[a-f0-9-]+\.png$/);
    expect(new Uint8Array(await asset.bytes.arrayBuffer())).toEqual(png);
  });
  it("拒绝伪装格式、空文件、SVG、超限尺寸和 MIME 不符", async () => {
    expect(() =>
      inspectImage(new TextEncoder().encode("<svg onload='x'/>")),
    ).toThrow();
    await expect(prepareImage(new File([], "empty.png"))).rejects.toThrow(
      "0 字节",
    );
    await expect(
      prepareImage(new File([png], "wrong.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow("MIME");
    const huge = png.slice();
    new DataView(huge.buffer).setUint32(16, 16_000_001);
    expect(() => inspectImage(huge)).toThrow("1600 万");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it("单图、数量、总字节限额在解码前拒绝", async () => {
    await expect(
      prepareImage(
        new File([new Uint8Array(IMAGE_LIMITS.bytes + 1)], "large.png"),
      ),
    ).rejects.toThrow("10 MiB");
    expect(() => checkImageBatch(Array.from({ length: 11 }, image))).toThrow(
      "10 张",
    );
    expect(() =>
      checkImageBatch(
        Array.from(
          { length: 4 },
          () => new File([new Uint8Array(9 * 1024 * 1024)], "large.png"),
        ),
      ),
    ).toThrow("32 MiB");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it("解码失败不能生成资源", async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error("broken image"));
    await expect(prepareImage(image())).rejects.toThrow("broken image");
  });
});
describe("异步图片插入归属和锚点", () => {
  it("提交完成前不插入，继续输入移动锚点且不丢新输入", async () => {
    let finish!: () => void;
    const append = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { controller, view } = editor(append);
    const task = controller.insert([image()]);
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
    expect(view.state.doc.toString()).toBe("abcdef");
    view.dispatch({ changes: { from: 0, insert: "前" } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    finish();
    await task;
    expect(view.state.doc.toString()).toMatch(
      /^前abc!\[图片\]\(asset\/image-.+\.png\)def$/,
    );
  });
  it.each(["cancel", "switch", "undo", "selection"])(
    "%s 后迟到提交不插入、不回滚正文",
    async (mode) => {
      let finish!: () => void;
      const append = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const { controller, view, target } = editor(append);
      if (mode === "selection") {
        controller.cancel();
        view.dispatch({ selection: { anchor: 1, head: 4 } });
        controller.begin(target);
      }
      const task = controller.insert([image()]);
      await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
      if (mode === "cancel") controller.cancel();
      if (mode === "switch") target.isCurrent = () => false;
      if (mode === "undo")
        view.dispatch({
          changes: { from: 0, insert: "撤销" },
          annotations: Transaction.userEvent.of("undo"),
        });
      if (mode === "selection")
        view.dispatch({ changes: { from: 2, to: 3, insert: "新" } });
      const expected = view.state.doc.toString();
      finish();
      await task;
      expect(view.state.doc.toString()).toBe(expected);
    },
  );
  it("写入失败保留选区与正文，后续可以重试", async () => {
    const append = vi.fn().mockRejectedValue(new Error("quota"));
    const { controller, view, target, errors } = editor(append);
    await controller.insert([image()]);
    expect(view.state.doc.toString()).toBe("abcdef");
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("quota"));
    expect(() => controller.begin(target)).not.toThrow();
    controller.cancel();
  });
  it("多图部分格式失败时保留成功项顺序", async () => {
    const { controller, view, errors } = editor();
    await controller.insert([
      image(),
      new File(["invalid"], "bad.png", { type: "image/png" }),
      image(),
    ]);
    expect(view.state.doc.toString().match(/!\[图片\]/g)).toHaveLength(2);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("bad.png"));
  });
});
describe("图片预览与复制边界", () => {
  it("只解析包内路径，缺图与越界不请求站点 URL", () => {
    const result = resolveArticleImages(
      '<img src="asset/a.png" srcset="asset/evil.png 2x"><img src="../secret.png"><img src="asset/%2e%2e.png"><img src="https://example.test/a.png">',
      new Map([["asset/a.png", "blob:synthetic"]]),
    );
    expect(result.html).toContain('src="blob:synthetic"');
    expect(result.html).not.toContain("srcset");
    expect(result.html).not.toContain('src="../');
    expect(result.missing).toHaveLength(2);
    expect(result.html).toContain('src="https://example.test/a.png"');
  });
  it("内置示例图兼容生产相对基础路径，不放行任意相对图片", () => {
    const result = resolveArticleImages(
      '<img src="./images/writing.svg"><img src="/images/mac-sign.svg"><img src="./images/private.png">',
      new Map(),
    );
    expect(result.html).toContain('src="./images/writing.svg"');
    expect(result.html).toContain('src="/images/mac-sign.svg"');
    expect(result.missing).toEqual(["./images/private.png"]);
    expect(() =>
      assertCopyableImages('<img src="./images/writing.svg">'),
    ).not.toThrow();
  });
  it("未验证本地图片转存前阻止两类复制假成功，外链和应用装饰图正常", () => {
    expect(() => assertCopyableImages('<img src="asset/a.png">')).toThrow(
      "本次未复制",
    );
    expect(() => assertCopyableImages('<img src="blob:private">')).toThrow();
    expect(() =>
      assertCopyableImages(
        '<img src="https://example.test/a.png"><img src="/images/writing.svg">',
      ),
    ).not.toThrow();
  });
});
