import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAssetPath,
  assertPrototypeName,
  normalizeLegacyArticle,
  packageDirectoryName,
  validateContent,
} from "../../storage/articles/articleContract";
import { syntheticArticle } from "./articlePrototypeFixtures";

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("文章与资源存储契约", () => {
  it.each([
    "../x.png",
    "asset/../x",
    "/asset/x",
    "asset/a/b",
    "asset/%2e%2e",
    "asset/a\\b",
    "asset/CON",
    "asset/a.",
    "asset/e\u0301.png",
    "asset/a\u0000.png",
  ])("拒绝越界与不可移植路径 %s", (path) => {
    expect(() => assertAssetPath(path)).toThrow();
  });
  it("保留旧文原值及未知字段，只在读取时补齐既有默认字段", () => {
    const original = {
      ...syntheticArticle(),
      createdAt: undefined,
      title: undefined,
      unknown: "保留",
    };
    const read = normalizeLegacyArticle(original);
    expect(read).toEqual({
      ...original,
      title: "未命名文章",
      createdAt: original.savedAt,
    });
    expect(original.createdAt).toBeUndefined();
    expect(read.markdown).toBe(original.markdown);
  });
  it("目录名安全、同名不同身份消歧，身份不取决于正文", async () => {
    const first = await packageDirectoryName("CON", "id-a");
    expect(first).toMatch(/^_CON--[a-f0-9]{12}$/);
    expect(first).not.toBe(await packageDirectoryName("CON", "id-b"));
    expect(await packageDirectoryName("../春/日%随笔", "id-a")).not.toMatch(
      /[/%]/,
    );
  });
  it("阻止真实数据源与跨文章、大小写重名、空资源", () => {
    expect(() => assertPrototypeName("wemd-history")).toThrow();
    expect(() => assertPrototypeName("radishink-p2a-prototype-")).toThrow();
    const article = syntheticArticle();
    expect(() => validateContent({ article, assets: [] }, "another")).toThrow();
    expect(() =>
      validateContent(
        {
          article,
          assets: [
            { path: "asset/A.png", bytes: new Blob(["x"]) },
            { path: "asset/a.png", bytes: new Blob(["y"]) },
          ],
        },
        article.id,
      ),
    ).toThrow();
    expect(() =>
      validateContent(
        { article, assets: [{ path: "asset/a.png", bytes: new Blob([]) }] },
        article.id,
      ),
    ).toThrow();
  });
});
