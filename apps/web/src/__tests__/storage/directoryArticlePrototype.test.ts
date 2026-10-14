import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryArticlePrototype } from "../../storage/articles/directoryArticlePrototype";
import {
  optionalFile,
  readText,
  writeFile,
} from "../../storage/articles/directoryArticleIO";
import {
  syntheticArticle,
  syntheticFileSystem,
} from "./articlePrototypeFixtures";

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const fs = syntheticFileSystem();
  const article = syntheticArticle();
  const articleId = article.id;
  const content = {
    article,
    assets: [
      {
        path: "asset/synthetic.bin",
        bytes: new Blob([new Uint8Array([0, 1, 255, 42])], {
          type: "application/octet-stream",
        }),
      },
    ],
  };
  const open = () =>
    new DirectoryArticlePrototype(fs.root, "合成文章--a", articleId, fs.locks);
  return { ...fs, article, content, open };
}

describe("目录文章的持久化与恢复原型（合成 File System Access）", () => {
  it("重开逐字节保留正文、未知元数据和资源，标题变化不移动目录", async () => {
    const { root, content, open } = fixture();
    Object.assign(content.article, { legacyField: "keep" });
    expect(await open().read()).toBeNull();
    await open().commit(content, null);
    const read = (await open().read())!;
    expect(read.article).toEqual(content.article);
    expect(await read.assets[0].bytes.arrayBuffer()).toEqual(
      await content.assets[0].bytes.arrayBuffer(),
    );
    expect(read.assets[0].bytes.type).toBe("application/octet-stream");
    const edited = {
      ...read,
      article: {
        ...syntheticArticle(),
        title: "改标题",
        markdown: `${read.article.markdown}\r\n继续写`,
      },
    };
    expect((await open().commit(edited, read.revision)).revision).toBe(1);
    expect((await open().read())!.article).toMatchObject({
      legacyField: "keep",
    });
    expect(await root.getDirectoryHandle("合成文章--a")).toBeTruthy();
  });

  it("完整复制旧散落 Markdown，不移动原件、不认领同目录其他文章", async () => {
    const { root, article, open } = fixture();
    const legacy = await root.getDirectoryHandle("旧目录", { create: true });
    await writeFile(legacy, "旧文.md", article.markdown);
    await writeFile(legacy, "另一篇.md", "另一篇合成文章");
    await open().copyLegacy("旧目录/旧文.md", article);
    expect(await readText((await optionalFile(legacy, "旧文.md"))!)).toBe(
      article.markdown,
    );
    expect(await readText((await optionalFile(legacy, "另一篇.md"))!)).toBe(
      "另一篇合成文章",
    );
    expect((await open().read())!.article.markdown).toBe(article.markdown);
    const target = await root.getDirectoryHandle("合成文章--a");
    expect(await target.getDirectoryHandle("asset")).toBeTruthy();
  });

  it.each([
    [
      "暂存资源",
      "close",
      (path: string) =>
        path.includes(".radishink-p2a") && path.endsWith("/synthetic.bin"),
      false,
    ],
    [
      "备份日志",
      "close",
      (path: string) => path.endsWith("/journal.json"),
      false,
    ],
    [
      "恢复日志",
      "close",
      (path: string) => path.endsWith("/pending.json"),
      false,
    ],
    [
      "身份标记",
      "close",
      (path: string) => path.endsWith("/.radishink-owner.json"),
      true,
    ],
    [
      "目标资源",
      "close",
      (path: string) => path.endsWith("/asset/synthetic.bin"),
      true,
    ],
    ["目标正文", "close", (path: string) => path.endsWith("/index.md"), true],
    ["完成记录", "close", (path: string) => path.endsWith("/state.json"), true],
    [
      "日志清理",
      "remove",
      (path: string) => path.endsWith("/pending.json"),
      true,
    ],
  ] as const)(
    "%s中断后可重开并恢复，不报告虚假成功",
    async (_phase, eventName, matches, needsRecovery) => {
      const { faults, content, open } = fixture();
      let injected = false;
      faults.step = (event, path) => {
        if (!injected && event === eventName && matches(path)) {
          injected = true;
          throw new DOMException("合成磁盘满", "QuotaExceededError");
        }
      };
      await expect(open().commit(content, null)).rejects.toThrow("合成磁盘满");
      expect(injected).toBe(true);
      faults.step = undefined;
      if (needsRecovery) {
        await expect(open().read()).rejects.toMatchObject({
          code: "recovery-required",
        });
        await expect(open().commit(content, null)).rejects.toMatchObject({
          code: "recovery-required",
        });
        await open().recover();
      } else {
        expect(await open().read()).toBeNull();
        await open().commit(content, null);
      }
      const read = (await open().read())!;
      expect(read.revision).toBe(0);
      expect(read.article).toEqual(content.article);
      expect(await read.assets[0].bytes.arrayBuffer()).toEqual(
        await content.assets[0].bytes.arrayBuffer(),
      );
      expect((await open().recover())!.revision).toBe(0);
    },
  );

  it("已有文章保存失败保留旧正文，恢复只完成对应版本", async () => {
    const { root, faults, content, open } = fixture();
    await open().commit(content, null);
    faults.step = (event, path) => {
      if (event === "close" && path.endsWith("/index.md"))
        throw new Error("合成中断");
    };
    const next = {
      ...content,
      article: { ...content.article, markdown: "新正文" },
    };
    await expect(open().commit(next, 0)).rejects.toThrow("合成中断");
    const folder = await root.getDirectoryHandle("合成文章--a");
    expect(await readText((await optionalFile(folder, "index.md"))!)).toBe(
      content.article.markdown,
    );
    faults.step = undefined;
    expect((await open().recover())!.article.markdown).toBe("新正文");
    await expect(open().commit(content, 0)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("恢复时遇到外部编辑保留目标和日志，不覆盖外部正文", async () => {
    const { root, faults, content, open } = fixture();
    faults.step = (event, path) => {
      if (event === "close" && path.endsWith("/index.md"))
        throw new Error("中断");
    };
    await expect(open().commit(content, null)).rejects.toThrow();
    faults.step = undefined;
    const folder = await root.getDirectoryHandle("合成文章--a");
    await writeFile(folder, "index.md", "外部编辑");
    await expect(open().recover()).rejects.toMatchObject({ code: "conflict" });
    expect(await readText((await optionalFile(folder, "index.md"))!)).toBe(
      "外部编辑",
    );
    await expect(open().read()).rejects.toMatchObject({
      code: "recovery-required",
    });
  });

  it("两个实例同时保存只有一个版本成功，旧版本不能覆盖", async () => {
    const { content, open } = fixture();
    const results = await Promise.allSettled([
      open().commit(content, null),
      open().commit(
        { ...content, article: { ...content.article, markdown: "另一份" } },
        null,
      ),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    expect((await open().read())!.article.markdown).toBe(
      content.article.markdown,
    );
  });

  it("权限撤回不会当作不存在，目标占用、资源覆盖和隐式删除均拒绝", async () => {
    const { root, faults, content, open } = fixture();
    faults.step = () => {
      throw new DOMException("权限撤回", "NotAllowedError");
    };
    await expect(open().commit(content, null)).rejects.toThrow("权限撤回");
    faults.step = undefined;
    await open().commit(content, null);
    await expect(
      open().commit({ ...content, assets: [] }, 0),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      open().commit(
        {
          ...content,
          assets: [
            { path: "asset/synthetic.bin", bytes: new Blob(["其他字节"]) },
          ],
        },
        0,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const other = new DirectoryArticlePrototype(
      root,
      "合成文章--a",
      "other",
      fixture().locks,
    );
    await expect(other.read()).rejects.toMatchObject({ code: "invalid" });
  });

  it("已有通用文件夹不能被复制操作认作文章包", async () => {
    const { root, content, open } = fixture();
    const target = await root.getDirectoryHandle("合成文章--a", {
      create: true,
    });
    await writeFile(target, "other.md", "保留");
    await expect(open().commit(content, null)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await readText((await optionalFile(target, "other.md"))!)).toBe(
      "保留",
    );
  });

  it("跨平台目录重名和外部资源修改不会被覆盖", async () => {
    const { root, content, open, locks } = fixture();
    await root.getDirectoryHandle("Case--a", { create: true });
    await expect(
      new DirectoryArticlePrototype(
        root,
        "case--a",
        content.article.id,
        locks,
      ).commit(content, null),
    ).rejects.toMatchObject({ code: "conflict" });
    await open().commit(content, null);
    const assets = await (
      await root.getDirectoryHandle("合成文章--a")
    ).getDirectoryHandle("asset");
    await writeFile(assets, "synthetic.bin", "外部资源");
    await expect(open().read()).rejects.toMatchObject({ code: "conflict" });
    await expect(open().commit(content, 0)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await readText((await optionalFile(assets, "synthetic.bin"))!)).toBe(
      "外部资源",
    );
  });

  it("调用时捕获内容和目标，等待期间修改输入不会串写其他文章", async () => {
    const { content, open } = fixture();
    const original = structuredClone(content.article);
    const pending = open().commit(content, null);
    content.article.id = "other";
    content.article.markdown = "等待中的另一篇";
    content.assets.length = 0;
    await pending;
    const read = (await open().read())!;
    expect(read.article).toEqual(original);
    expect(read.assets).toHaveLength(1);
  });

  it("复制中断后源文件变化时拒绝恢复，保留两份候选", async () => {
    const { root, article, faults, open } = fixture();
    await writeFile(root, "旧文.md", article.markdown);
    faults.step = (event, path) => {
      if (event === "close" && path.endsWith("/index.md"))
        throw new Error("中断");
    };
    await expect(open().copyLegacy("旧文.md", article)).rejects.toThrow();
    faults.step = undefined;
    await writeFile(root, "旧文.md", "外部更新的源文");
    await expect(open().recover()).rejects.toMatchObject({ code: "conflict" });
    expect(await readText((await optionalFile(root, "旧文.md"))!)).toBe(
      "外部更新的源文",
    );
  });

  it("日志路径注入、归属变化和无互斥能力不能写入", async () => {
    const { root, content, faults, open } = fixture();
    expect(
      () => new DirectoryArticlePrototype(root, "../escape", "a"),
    ).toThrow();
    const noLocks = new DirectoryArticlePrototype(
      root,
      "target",
      content.article.id,
      undefined,
    );
    await expect(noLocks.commit(content, null)).rejects.toMatchObject({
      code: "unsupported",
    });
    faults.step = (event, path) => {
      if (event === "close" && path.endsWith("/index.md"))
        throw new Error("中断");
    };
    await expect(open().commit(content, null)).rejects.toThrow();
    faults.step = undefined;
    const control = await (
      await root.getDirectoryHandle(".radishink-p2a")
    ).getDirectoryHandle("合成文章--a");
    const journal = JSON.parse(
      await readText((await optionalFile(control, "pending.json"))!),
    );
    journal.operation = "../escape";
    await writeFile(control, "pending.json", JSON.stringify(journal));
    await expect(open().recover()).rejects.toMatchObject({ code: "invalid" });
  });
});
