import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticArticle } from "../storage/articlePrototypeFixtures";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  commit: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../storage/articles/browserArticleDatabase", () => ({
  openBrowserArticleDatabase: mocks.open,
  readHistoryBackup: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.open.mockResolvedValue({
    article: () => ({ commit: mocks.commit }),
    list: mocks.list,
    remove: mocks.remove,
  });
  mocks.list.mockResolvedValue([
    {
      article: syntheticArticle("one"),
      revision: 7,
      assets: [{ path: "asset/kept.png", bytes: new Blob(["kept"]) }],
    },
  ]);
});

describe("实际历史数据库接入", () => {
  it("导入正文与资源同次提交，失败不发布缓存", async () => {
    const db = await import("../../store/historyDb");
    await db.loadHistoryFromDb();
    const assets = [{ path: "asset/import.png", bytes: new Blob(["bytes"]) }];
    mocks.commit.mockRejectedValueOnce(new Error("quota"));
    await expect(
      db.addHistoryToDb(syntheticArticle("import"), assets),
    ).rejects.toThrow("quota");
    expect(() => db.getHistoryAssets("import")).toThrow();
    expect(mocks.commit).toHaveBeenCalledWith(
      { article: syntheticArticle("import"), assets },
      null,
    );
    mocks.commit.mockImplementation(async (content) => ({
      ...content,
      revision: 1,
    }));
    await db.addHistoryToDb(syntheticArticle("import"), assets);
    expect(db.getHistoryAssets("import")).toEqual(assets);
  });

  it("资源追加配额失败不提升版本或污染资源缓存，重试沿用原基线", async () => {
    const db = await import("../../store/historyDb");
    await db.loadHistoryFromDb();
    const asset = { path: "asset/new.png", bytes: new Blob(["new"]) };
    mocks.commit.mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );
    await expect(db.appendHistoryAssets("one", [asset])).rejects.toThrow(
      "quota",
    );
    expect(db.getHistoryAssets("one").map((a) => a.path)).toEqual([
      "asset/kept.png",
    ]);
    mocks.commit.mockImplementation(async (content, revision) => ({
      ...content,
      revision: revision + 1,
    }));
    await db.appendHistoryAssets("one", [asset]);
    expect(mocks.commit.mock.calls[1][1]).toBe(7);
    expect(db.getHistoryAssets("one")).toHaveLength(2);
    await db.updateHistoryInDb({
      ...syntheticArticle("one"),
      markdown: "后续正文",
    });
    expect(mocks.commit.mock.calls[2][0].assets).toHaveLength(2);
    expect(mocks.commit.mock.calls[2][1]).toBe(8);
  });
  it.each(["addHistoryToDb", "updateHistoryInDb"] as const)(
    "%s 等待提交失败，不提前报告成功",
    async (method) => {
      const db = await import("../../store/historyDb");
      await db.loadHistoryFromDb();
      let reject!: (error: Error) => void;
      mocks.commit.mockImplementation(
        () =>
          new Promise((_, r) => {
            reject = r;
          }),
      );
      const pending = db[method](syntheticArticle("one"));
      const assertion = expect(pending).rejects.toThrow("quota");
      await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce());
      reject(new Error("quota"));
      await assertion;
    },
  );
  it("保存沿用读取版本和二进制资源，失败后不提升版本", async () => {
    const db = await import("../../store/historyDb");
    await db.loadHistoryFromDb();
    mocks.commit
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValue({
        article: syntheticArticle("one"),
        revision: 8,
        assets: [],
      });
    await expect(db.updateHistoryInDb(syntheticArticle("one"))).rejects.toThrow(
      "conflict",
    );
    await db.updateHistoryInDb(syntheticArticle("one"));
    for (const [content, revision] of mocks.commit.mock.calls) {
      expect(revision).toBe(7);
      expect(content.assets[0].path).toBe("asset/kept.png");
    }
  });
  it("读取错误向上传播，不能返回空工作区", async () => {
    mocks.open.mockRejectedValueOnce(new Error("unavailable"));
    const db = await import("../../store/historyDb");
    await expect(db.loadHistoryFromDb()).rejects.toThrow("unavailable");
    expect(
      (
        await import("../../store/historyStorageState")
      ).useHistoryStorageState.getState().status,
    ).toBe("error");
  });
  it("初始化失败可重试，不缓存拒绝的连接", async () => {
    mocks.open.mockRejectedValueOnce(new Error("blocked"));
    const db = await import("../../store/historyDb");
    await expect(db.loadHistoryFromDb()).rejects.toThrow();
    expect(await db.loadHistoryFromDb()).toHaveLength(1);
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
  it.each(["deleteHistoryFromDb", "clearHistoryDb"] as const)(
    "%s 传播删除失败并保留读取版本",
    async (method) => {
      const db = await import("../../store/historyDb");
      await db.loadHistoryFromDb();
      mocks.remove.mockRejectedValue(new Error("conflict"));
      await expect(db[method]("one")).rejects.toThrow("conflict");
      expect(mocks.remove.mock.calls[0][0].get("one")).toBe(7);
    },
  );
  it("未就绪不能创建文章", async () => {
    const db = await import("../../store/historyDb");
    await expect(db.addHistoryToDb(syntheticArticle("new"))).rejects.toThrow(
      "尚未就绪",
    );
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
