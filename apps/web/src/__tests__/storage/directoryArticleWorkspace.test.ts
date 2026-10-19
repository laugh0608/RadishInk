import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryArticleWorkspace } from "../../storage/articles/directoryArticleWorkspace";
import { DirectoryArticleStore } from "../../storage/articles/directoryArticleStore";
import { FileSystemAdapter } from "../../storage/adapters/FileSystemAdapter";
import {
  readText,
  optionalFile,
  readJson,
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
  const fs = syntheticFileSystem("合成用户工作区");
  const workspace = () => new DirectoryArticleWorkspace(fs.root, fs.locks);
  return { ...fs, workspace };
}
async function packageFixture() {
  const fs = fixture();
  const article = syntheticArticle();
  const store = new DirectoryArticleStore(
    fs.root,
    "合成包",
    article.id,
    fs.locks,
  );
  await store.commit(
    {
      article,
      assets: [
        { path: "asset/a.bin", bytes: new Blob([new Uint8Array([0, 255, 1])]) },
      ],
    },
    null,
  );
  const workspace = fs.workspace();
  await workspace.read("合成包/index.md");
  return { ...fs, article, store, workspace, path: "合成包/index.md" };
}

describe("实际目录文章与整包生命周期（合成句柄）", () => {
  it("图片追加与正文保存串行，重开后原字节完整且旧资源保留", async () => {
    const { workspace, root, locks, path } = await packageFixture();
    const bytes = new Blob([new Uint8Array([9, 0, 255, 7])]);
    await Promise.all([
      workspace.appendAssets(path, [{ path: "asset/image.png", bytes }]),
      workspace.write(path, "# 新正文\n![图](asset/image.png)"),
    ]);
    const reopened = new DirectoryArticleWorkspace(root, locks);
    expect(await reopened.read(path)).toContain("asset/image.png");
    const assets = reopened.getAssets(path);
    expect(assets).toHaveLength(2);
    expect(new Uint8Array(await assets[1].bytes.arrayBuffer())).toEqual(
      new Uint8Array([9, 0, 255, 7]),
    );
    await workspace.write(path, "删除引用后仍保留资源供撤销");
    expect(workspace.getAssets(path)).toHaveLength(2);
  });
  it("图片追加发生权限错误时不改变已读快照", async () => {
    const { workspace, path, faults } = await packageFixture();
    faults.step = () => {
      throw new DOMException("synthetic revoked", "NotAllowedError");
    };
    await expect(
      workspace.appendAssets(path, [
        { path: "asset/new.png", bytes: new Blob(["new"]) },
      ]),
    ).rejects.toThrow("synthetic revoked");
    expect(workspace.getAssets(path).map((a) => a.path)).toEqual([
      "asset/a.bin",
    ]);
  });
  it("新建形成标准目录，列表折叠为文章，重开保留 BOM/CRLF", async () => {
    const fs = fixture();
    const w = fs.workspace();
    const content = syntheticArticle().markdown;
    const path = await w.create(content, "合成文章");
    expect(path).toMatch(/^合成文章--[a-f0-9]{12}\/index.md$/);
    expect(await fs.workspace().read(path)).toBe(content);
    const list = await w.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ path, meta: { articlePackage: true } });
    expect(
      await (
        await fs.root.getDirectoryHandle(path.split("/")[0])
      ).getDirectoryHandle("asset"),
    ).toBeTruthy();
  });
  it("复制旧散落文章只复制正文，原文、相邻图片和另一篇正文保持原位", async () => {
    const fs = fixture();
    const folder = await fs.root.getDirectoryHandle("旧文件", { create: true });
    await writeFile(folder, "旧文.md", syntheticArticle().markdown);
    await writeFile(folder, "别篇.md", "other");
    await writeFile(folder, "image.png", new Blob([new Uint8Array([8, 9])]));
    const path = await fs.workspace().copyLegacy("旧文件/旧文.md");
    expect(await fs.workspace().read(path)).toBe(syntheticArticle().markdown);
    expect(await readText((await optionalFile(folder, "别篇.md"))!)).toBe(
      "other",
    );
    expect(
      await (await optionalFile(folder, "image.png"))!.arrayBuffer(),
    ).toEqual(new Uint8Array([8, 9]).buffer);
  });
  it("两实例读后保存检查版本，外部正文修改不会被覆盖", async () => {
    const { workspace: w, root, path, locks } = await packageFixture();
    const other = new DirectoryArticleWorkspace(root, locks);
    await other.read(path);
    await w.write(path, "first");
    await expect(other.write(path, "second")).rejects.toThrow("版本已变化");
    await writeFile(
      await root.getDirectoryHandle("合成包"),
      "index.md",
      "external",
    );
    await expect(w.write(path, "third")).rejects.toThrow("外部修改");
    expect(
      await readText(
        (await optionalFile(
          await root.getDirectoryHandle("合成包"),
          "index.md",
        ))!,
      ),
    ).toBe("external");
  });
  it.each(["index.md", "state.json", "pending.json"])(
    "%s 提交失败后新实例可以恢复，并保留资源字节",
    async (name) => {
      const {
        workspace: w,
        root,
        path,
        faults,
        locks,
      } = await packageFixture();
      faults.step = (event, p) => {
        if (event === "close" && p.endsWith(`/${name}`))
          throw new DOMException("full", "QuotaExceededError");
      };
      await expect(w.write(path, "updated")).rejects.toThrow("full");
      faults.step = undefined;
      const reopened = new DirectoryArticleWorkspace(root, locks);
      await reopened.recover(path);
      const result = await reopened.read(path);
      // pending close 未发布时原提交仍有效；其余阶段向前完成。
      expect(result).toBe(
        name === "pending.json" ? syntheticArticle().markdown : "updated",
      );
      expect(
        new Uint8Array(
          await (await optionalFile(
            await (
              await root.getDirectoryHandle("合成包")
            ).getDirectoryHandle("asset"),
            "a.bin",
          ))!.arrayBuffer(),
        ),
      ).toEqual(new Uint8Array([0, 255, 1]));
    },
  );
  it("未授权或损坏写入保持失败，不删除未完成日志", async () => {
    const { workspace: w, path, faults } = await packageFixture();
    faults.step = (event, p) => {
      if (event === "close" && p.endsWith("/index.md"))
        throw new DOMException("denied", "NotAllowedError");
    };
    await expect(w.write(path, "new")).rejects.toThrow("denied");
    faults.step = undefined;
    await expect(w.cleanupHistory(path)).rejects.toThrow("未完成写入");
    await w.recover(path);
    expect(await w.read(path)).toBe("new");
  });
  it("移动整包保留身份、控制记录及图片，移动后还能保存", async () => {
    const { workspace: w, root, path, article } = await packageFixture();
    await root.getDirectoryHandle("归档", { create: true });
    const next = await w.operate(path, "归档");
    expect(next).toBe("归档/合成包/index.md");
    expect(await w.read(next!)).toBe(article.markdown);
    await w.write(next!, "after move");
    await expect(root.getDirectoryHandle("合成包")).rejects.toThrow();
    const operations = await w.operations();
    expect(operations[0].complete).toBe(true);
    await w.cleanupOperation(operations[0].id);
    expect(await w.operations()).toEqual([]);
  });
  it("删除整包会保留已校验恢复副本；未知文件阻止删除", async () => {
    const { workspace: w, root, path } = await packageFixture();
    const folder = await root.getDirectoryHandle("合成包");
    await writeFile(folder, "陌生.txt", "keep");
    await expect(w.operate(path, null)).rejects.toThrow("未知文件");
    await folder.removeEntry("陌生.txt");
    await w.operate(path, null);
    expect(await w.list()).toEqual([]);
    const [op] = await w.operations();
    expect(op.complete).toBe(true);
    const backup = await (
      await (
        await root.getDirectoryHandle(".radishink-operations")
      ).getDirectoryHandle(op.id)
    ).getDirectoryHandle("package");
    expect(await readText((await optionalFile(backup, "index.md"))!)).toBe(
      syntheticArticle().markdown,
    );
  });
  it("移动目标写入中断，原包禁止继续保存，新实例恢复后完整校验", async () => {
    const { workspace: w, root, path, faults, locks } = await packageFixture();
    await root.getDirectoryHandle("归档", { create: true });
    faults.step = (event, p) => {
      if (event === "close" && p === "/归档/合成包/index.md")
        throw new Error("disk interrupted");
    };
    await expect(w.operate(path, "归档")).rejects.toThrow("disk interrupted");
    faults.step = undefined;
    await expect(w.write(path, "unsafe")).rejects.toThrow("移动或删除");
    const reopened = new DirectoryArticleWorkspace(root, locks);
    const [op] = await reopened.operations();
    expect(op.complete).toBe(false);
    await expect(reopened.cleanupOperation(op.id)).rejects.toThrow(
      "未完成操作",
    );
    await reopened.recoverOperation(op.id);
    expect(await reopened.read("归档/合成包/index.md")).toBe(
      syntheticArticle().markdown,
    );
  });
  it("移动恢复遇到外部改写目标时保留原件与两份副本", async () => {
    const { workspace: w, root, path, faults } = await packageFixture();
    await root.getDirectoryHandle("归档", { create: true });
    faults.step = (event, p) => {
      if (event === "remove" && p === "/合成包") throw new Error("interrupt");
    };
    await expect(w.operate(path, "归档")).rejects.toThrow("interrupt");
    faults.step = undefined;
    const target = await (
      await root.getDirectoryHandle("归档")
    ).getDirectoryHandle("合成包");
    await writeFile(target, "index.md", "external");
    const [op] = await w.operations();
    await expect(w.recoverOperation(op.id)).rejects.toThrow("其他内容");
    expect(await root.getDirectoryHandle("合成包")).toBeTruthy();
    expect(await readText((await optionalFile(target, "index.md"))!)).toBe(
      "external",
    );
  });
  it("目录改名/删除不能绕过整包规则；包内路径禁止当普通文件编辑", async () => {
    const { workspace: w, path, root } = await packageFixture();
    await expect(w.assertNoPackages("合成包")).rejects.toThrow("文章包内部");
    await expect(w.create("bad", "bad", "合成包/asset")).rejects.toThrow(
      "文章包内部",
    );
    await writeFile(
      await root.getDirectoryHandle("合成包"),
      "index.md",
      "external",
    );
    await expect(w.operate(path, null)).rejects.toThrow("外部修改");
  });
  it("清理提交日志保留当前正文、资源和状态，未知暂存不清理", async () => {
    const { workspace: w, root, path } = await packageFixture();
    await w.write(path, "new");
    expect(await w.cleanupHistory(path)).toBe(2);
    expect(await w.read(path)).toBe("new");
    const control = await (
      await root.getDirectoryHandle("合成包")
    ).getDirectoryHandle(".radishink");
    expect(await readJson(control, "state.json")).toBeTruthy();
    await writeFile(control, "unknown.json", "keep");
    expect(await w.cleanupHistory(path)).toBe(0);
    expect(await optionalFile(control, "unknown.json")).toBeTruthy();
  });
  it("实际适配器保留旧文外部变更检查和 .wemd 主题路径", async () => {
    const fs = fixture();
    vi.stubGlobal("navigator", { locks: fs.locks });
    const adapter = new FileSystemAdapter();
    Object.assign(adapter, { directoryHandle: fs.root, ready: true });
    await adapter.writeFile(".wemd/themes.json", '{"themes":[]}');
    expect(await adapter.readFile(".wemd/themes.json")).toBe('{"themes":[]}');
    await writeFile(fs.root, "legacy.md", "old");
    expect(await adapter.readFile("legacy.md")).toBe("old");
    await writeFile(fs.root, "legacy.md", "external");
    await expect(adapter.writeFile("legacy.md", "mine")).rejects.toThrow(
      "外部修改",
    );
    const path = await adapter.createArticle("# body", "标题");
    expect(await adapter.readFile(path)).toBe("# body");
    await adapter.writeFile(path, "# updated");
    expect(await adapter.readFile(path)).toBe("# updated");
  });
  it("冲突另存保留当前正文、已读取图片与原包外部版本", async () => {
    const { workspace: w, root, path, locks } = await packageFixture();
    await writeFile(
      await root.getDirectoryHandle("合成包"),
      "index.md",
      "external",
    );
    const copy = await w.saveConflictCopy(path, "my edit");
    expect(copy.path).not.toBe(path);
    expect(
      await new DirectoryArticleWorkspace(root, locks).read(copy.path),
    ).toContain("my edit");
    expect(
      await readText(
        (await optionalFile(
          await root.getDirectoryHandle("合成包"),
          "index.md",
        ))!,
      ),
    ).toBe("external");
    const copiedFolder = await root.getDirectoryHandle(copy.path.split("/")[0]);
    expect(
      new Uint8Array(
        await (await optionalFile(
          await copiedFolder.getDirectoryHandle("asset"),
          "a.bin",
        ))!.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([0, 255, 1]));
  });
  it("清理拒绝已被外部修改的暂存资源", async () => {
    const { workspace: w, root, path } = await packageFixture();
    const control = await (
      await root.getDirectoryHandle("合成包")
    ).getDirectoryHandle(".radishink");
    for await (const entry of control.values())
      if (entry.kind === "directory")
        await writeFile(
          await control.getDirectoryHandle(entry.name),
          "a.bin",
          "external",
        );
    await expect(w.cleanupHistory(path)).rejects.toThrow("暂存资源已改变");
    expect(await w.read(path)).toBe(syntheticArticle().markdown);
  });
  it("缺少 Web Locks 不启用目录文章写入", async () => {
    const fs = fixture();
    const w = new DirectoryArticleWorkspace(fs.root, undefined);
    await expect(w.create("body", "title")).rejects.toThrow("Web Locks");
  });
});
