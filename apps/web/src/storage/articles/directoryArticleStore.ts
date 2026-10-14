import type { HistorySnapshot } from "../../store/historyTypes";
import {
  ArticleStorageError,
  assertRevision,
  assertSegment,
  digest,
  validateContent,
  type ArticleContent,
  type ArticleSnapshot,
  type ArticleStore,
} from "./articleContract";
import {
  optionalDirectory,
  optionalFile,
  readJson,
  readText,
  writeFile,
  validateManifest,
  verifyManifest,
  type ArticleManifest,
} from "./directoryArticleIO";

interface Journal {
  format: 1;
  articleId: string;
  directory: string;
  operation: string;
  before: ArticleManifest | null;
  after: ArticleManifest;
  source?: { path: string; hash: string };
}

function sourceSegments(path: string) {
  const parts = path.split("/");
  parts.forEach(assertSegment);
  if (!/\.(md|markdown)$/i.test(parts.at(-1)!))
    throw new ArticleStorageError("invalid", "旧文来源必须是 Markdown 文件");
  return parts;
}

/** 绑定文章与已授权父目录；正文、资源、控制日志共同组成文章包。 */
export class DirectoryArticleStore implements ArticleStore {
  constructor(
    private readonly root: FileSystemDirectoryHandle,
    readonly directory: string,
    readonly articleId: string,
    private readonly locks:
      | Pick<LockManager, "request">
      | undefined = navigator.locks,
    private readonly legacyControl = false,
  ) {
    assertSegment(directory);
  }

  private locked<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.locks)
      return Promise.reject(
        new ArticleStorageError(
          "unsupported",
          "目录写入需要 Web Locks，当前环境不提供安全降级",
        ),
      );
    // 同源所有目录文章共用锁，避免别名句柄或不同文章实例绕过互斥。
    return this.locks.request("radishink:directory-articles", operation);
  }

  private async control(create = false) {
    if (!this.legacyControl) {
      let folder = await this.packageFolder();
      if (!folder && create)
        folder = await this.root.getDirectoryHandle(this.directory, {
          create: true,
        });
      if (!folder) return null;
      if (create) await this.checkOwner(folder, true);
      return create
        ? folder.getDirectoryHandle(".radishink", { create: true })
        : optionalDirectory(folder, ".radishink");
    }
    const parent = create
      ? await this.root.getDirectoryHandle(".radishink-p2a", { create: true })
      : await optionalDirectory(this.root, ".radishink-p2a");
    if (!parent) return null;
    return create
      ? parent.getDirectoryHandle(this.directory, { create: true })
      : optionalDirectory(parent, this.directory);
  }

  private async packageFolder() {
    for await (const entry of this.root.values()) {
      if (
        entry.name !== this.directory &&
        entry.name.normalize("NFC").toLocaleLowerCase("en-US") ===
          this.directory.toLocaleLowerCase("en-US")
      ) {
        throw new ArticleStorageError(
          "conflict",
          "目标目录存在大小写或 Unicode 同名冲突",
        );
      }
    }
    return optionalDirectory(this.root, this.directory);
  }

  private async state(control: FileSystemDirectoryHandle | null) {
    const value = control && (await readJson(control, "state.json"));
    if (value === null) return null;
    validateManifest(value, this.articleId);
    return value;
  }

  private async pending(control: FileSystemDirectoryHandle) {
    const value = await readJson(control, "pending.json");
    if (value === null) return null;
    const journal = value as Journal;
    if (
      journal.format !== 1 ||
      journal.articleId !== this.articleId ||
      journal.directory !== this.directory ||
      !/^[a-f0-9-]{36}$/.test(journal.operation)
    ) {
      throw new ArticleStorageError("invalid", "恢复日志格式或文章归属不匹配");
    }
    validateManifest(journal.after, this.articleId);
    if (journal.before !== null)
      validateManifest(journal.before, this.articleId);
    assertRevision(
      journal.after.revision,
      (journal.before?.revision ?? -1) + 1,
    );
    if (journal.source) {
      sourceSegments(journal.source.path);
      if (!/^[a-f0-9]{64}$/.test(journal.source.hash))
        throw new ArticleStorageError("invalid", "来源校验记录无效");
    }
    return journal;
  }

  private async load(): Promise<ArticleSnapshot | null> {
    const control = await this.control();
    if (control && (await readJson(control, "lifecycle.json")))
      throw new ArticleStorageError(
        "recovery-required",
        "文章正在移动或删除，请从目录维护入口恢复整包操作",
      );
    if (control && (await this.pending(control)))
      throw new ArticleStorageError(
        "recovery-required",
        "文章存在未完成写入，请先恢复或保留冲突副本",
      );
    const state = await this.state(control);
    const folder = await this.packageFolder();
    if (!state && !folder) return null;
    // pending 发布前失败只留下本应用占用的空包；允许显式重试创建。
    if (!this.legacyControl && !state && folder) {
      await this.checkOwner(folder, false);
      for await (const entry of folder.values()) {
        if (![".radishink-owner.json", ".radishink"].includes(entry.name))
          throw new ArticleStorageError(
            "conflict",
            "未完成包含有其他内容，不能自动覆盖",
          );
      }
      return null;
    }
    if (!state || !folder)
      throw new ArticleStorageError(
        "conflict",
        "目标目录已被占用或文章控制记录缺失，不能覆盖",
      );
    await this.checkOwner(folder, false);
    return verifyManifest(folder, state);
  }

  read() {
    return this.locked(() => this.load());
  }

  async commit(input: ArticleContent, expectedRevision: number | null) {
    const content = {
      article: structuredClone(input.article),
      assets: input.assets.map((asset) => ({ ...asset })),
    };
    validateContent(content, this.articleId);
    return this.locked(() => this.save(content, expectedRevision));
  }

  /** 调用方明确选择的旧文复制为新包；旧文件及同目录其他文件始终保留。 */
  copyLegacy(sourcePath: string, input: HistorySnapshot) {
    sourceSegments(sourcePath);
    const article = structuredClone(input);
    validateContent({ article, assets: [] }, this.articleId);
    return this.locked(async () => {
      const source = await this.sourceFile(sourcePath);
      if ((await readText(source)) !== article.markdown)
        throw new ArticleStorageError(
          "conflict",
          "源文件已变化，请重新读取后复制",
        );
      return this.save({ article, assets: [] }, null, {
        path: sourcePath,
        hash: await digest(source),
      });
    });
  }

  private async sourceFile(path: string) {
    const parts = sourceSegments(path);
    const name = parts.pop()!;
    let folder = this.root;
    for (const part of parts) folder = await folder.getDirectoryHandle(part);
    return (await folder.getFileHandle(name)).getFile();
  }

  private async save(
    content: ArticleContent,
    expectedRevision: number | null,
    source?: Journal["source"],
  ) {
    const current = await this.load();
    assertRevision(current?.revision ?? null, expectedRevision);
    if (current && current.article.createdAt !== content.article.createdAt)
      throw new ArticleStorageError("invalid", "保存不能改变文章创建时间");
    const assets = await Promise.all(
      content.assets.map(async (asset) => ({
        path: asset.path,
        hash: await digest(asset.bytes),
        size: asset.bytes.size,
        type: asset.bytes.type,
      })),
    );
    const control = (await this.control(true))!;
    const before = await this.state(control);
    for (const old of before?.assets ?? []) {
      if (
        !assets.some(
          (asset) => asset.path === old.path && asset.hash === old.hash,
        )
      )
        throw new ArticleStorageError("conflict", "已有资源不可覆盖或隐式删除");
    }
    const operation = crypto.randomUUID();
    const staging = await control.getDirectoryHandle(operation, {
      create: true,
    });
    for (const asset of content.assets) {
      await writeFile(staging, asset.path.slice(6), asset.bytes);
      const written = await optionalFile(staging, asset.path.slice(6));
      if (
        !written ||
        (await digest(written)) !==
          assets.find((item) => item.path === asset.path)!.hash
      )
        throw new ArticleStorageError("invalid", "暂存资源校验失败");
    }
    const after: ArticleManifest = {
      format: 1,
      revision: (current?.revision ?? -1) + 1,
      article: { ...current?.article, ...content.article },
      assets,
    };
    const journal: Journal = {
      format: 1,
      articleId: this.articleId,
      directory: this.directory,
      operation,
      before,
      after,
      ...(source ? { source } : {}),
    };
    await writeFile(staging, "journal.json", JSON.stringify(journal));
    // pending 落盘前不改目标文章；落盘后仅 recover 可推进，普通保存明确拒绝。
    await writeFile(control, "pending.json", JSON.stringify(journal));
    return this.apply(control, journal);
  }

  recover() {
    return this.locked(async () => {
      const control = await this.control();
      if (control && (await readJson(control, "lifecycle.json")))
        throw new ArticleStorageError("recovery-required", "请先恢复整包操作");
      const journal = control && (await this.pending(control));
      return control && journal ? this.apply(control, journal) : this.load();
    });
  }

  private async checkOwner(
    folder: FileSystemDirectoryHandle,
    reserve: boolean,
  ) {
    const owner = (await readJson(folder, ".radishink-owner.json")) as {
      format?: number;
      articleId?: string;
    } | null;
    if (owner?.format === 1 && owner.articleId === this.articleId) return;
    if (owner || !reserve)
      throw new ArticleStorageError("conflict", "目标文章身份标记缺失或不匹配");
    for await (const entry of folder.values()) {
      if (entry.name !== ".radishink-owner.json")
        throw new ArticleStorageError(
          "conflict",
          "目标目录已有其他内容，不能认领为文章包",
        );
    }
    await writeFile(
      folder,
      ".radishink-owner.json",
      JSON.stringify({ format: 1, articleId: this.articleId }),
    );
  }

  private async apply(
    control: FileSystemDirectoryHandle,
    journal: Journal,
  ): Promise<ArticleSnapshot> {
    const staging = await control.getDirectoryHandle(journal.operation);
    if (
      JSON.stringify(await readJson(staging, "journal.json")) !==
      JSON.stringify(journal)
    ) {
      throw new ArticleStorageError(
        "invalid",
        "待恢复标记与暂存操作日志不一致",
      );
    }
    const currentState = await this.state(control);
    if (
      JSON.stringify(currentState) !== JSON.stringify(journal.before) &&
      JSON.stringify(currentState) !== JSON.stringify(journal.after)
    ) {
      throw new ArticleStorageError(
        "conflict",
        "恢复日志与当前版本不一致，保留日志等待处理",
      );
    }
    if (
      journal.source &&
      (await digest(await this.sourceFile(journal.source.path))) !==
        journal.source.hash
    ) {
      throw new ArticleStorageError(
        "conflict",
        "复制期间源文件发生变化，保留原件与暂存副本",
      );
    }
    let folder = await this.packageFolder();
    if (journal.before && !folder)
      throw new ArticleStorageError(
        "conflict",
        "原文章目录丢失，不能自动重建覆盖",
      );
    if (!folder)
      folder = await this.root.getDirectoryHandle(this.directory, {
        create: true,
      });
    await this.checkOwner(folder, journal.before === null);
    const assetFolder = await folder.getDirectoryHandle("asset", {
      create: true,
    });
    const markdown = await optionalFile(folder, "index.md");
    const actual = markdown ? await readText(markdown) : null;
    if (
      actual !== journal.after.article.markdown &&
      actual !== (journal.before?.article.markdown ?? null) &&
      !(actual === "" && journal.before === null)
    ) {
      throw new ArticleStorageError(
        "conflict",
        "恢复前发现外部正文修改，保留原文、目标和日志",
      );
    }
    // 已有资源必须仍然存在且保持原字节，不能用暂存文件掩盖外部修改。
    for (const old of journal.before?.assets ?? []) {
      const file = await optionalFile(assetFolder, old.path.slice(6));
      if (!file || (await digest(file)) !== old.hash)
        throw new ArticleStorageError(
          "conflict",
          `恢复前资源发生变化：${old.path}`,
        );
    }
    for (const asset of journal.after.assets) {
      const name = asset.path.slice(6);
      for await (const entry of assetFolder.values()) {
        if (
          entry.name !== name &&
          entry.name.normalize("NFC").toLocaleLowerCase("en-US") ===
            name.toLocaleLowerCase("en-US")
        )
          throw new ArticleStorageError(
            "conflict",
            `资源名称存在大小写或 Unicode 冲突：${asset.path}`,
          );
      }
      const staged = await optionalFile(staging, name);
      if (
        !staged ||
        staged.size !== asset.size ||
        (await digest(staged)) !== asset.hash
      )
        throw new ArticleStorageError("invalid", "恢复所需暂存资源缺失或损坏");
      const existing = await optionalFile(assetFolder, name);
      if (existing && existing.size && (await digest(existing)) !== asset.hash)
        throw new ArticleStorageError(
          "conflict",
          `目标资源名称已被占用：${asset.path}`,
        );
      // 新资源的零字节文件可来自 createWritable 失败；非空异值绝不覆盖。
      if (!existing || !existing.size)
        await writeFile(assetFolder, name, staged);
    }
    // 再次读取缩小外部编辑窗口；File System Access 没有跨文件原子 CAS。
    const latest = await optionalFile(folder, "index.md");
    if ((latest ? await readText(latest) : null) !== actual)
      throw new ArticleStorageError("conflict", "写入前正文再次变化");
    if (actual !== journal.after.article.markdown)
      await writeFile(folder, "index.md", journal.after.article.markdown);
    const snapshot = await verifyManifest(folder, journal.after);
    await writeFile(control, "state.json", JSON.stringify(journal.after));
    await control.removeEntry("pending.json");
    // 暂存与 before 日志不自动递归清理；显式清理策略在资源生命周期阶段接入。
    return snapshot;
  }
}
