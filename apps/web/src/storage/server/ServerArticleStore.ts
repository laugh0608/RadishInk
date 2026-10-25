import {
  ArticleStorageError,
  assertAssetPath,
  digest,
  normalizeLegacyArticle,
  validateContent,
  type ArticleContent,
  type ArticleSnapshot,
  type ArticleStore,
} from "../articles/articleContract";
import {
  ServerClient,
  identityKey,
  uuid,
  isDefiniteRejection,
} from "./serverClient";

interface Descriptor {
  path: string;
  sha256: string;
  size: number;
}
interface RemoteSnapshot {
  articleId: string;
  revision: number;
  markdown: string;
  metadata: Record<string, unknown>;
  assets: Descriptor[];
}
interface Pending {
  rejected?: boolean;
  key: string;
  operationId: string;
  expected: number | null;
  content: ArticleContent;
  body: FormData;
}
export class ServerArticleStore implements ArticleStore {
  private readonly identity: string;
  private readonly generation: number;
  snapshot: ArticleSnapshot | null = null;
  private pending: Pending | null = null;
  private deletion: { operationId: string; expectedRevision: number } | null =
    null;
  constructor(
    readonly client: ServerClient,
    readonly articleId: string,
  ) {
    if (!uuid(articleId) || !client.session)
      throw new Error("文章身份或会话无效");
    this.identity = identityKey(client.session);
    this.generation = client.generation;
  }
  private assertCurrent() {
    if (
      !this.client.session ||
      this.client.generation !== this.generation ||
      identityKey(this.client.session) !== this.identity
    )
      throw new Error("工作区身份已变化，请重新打开文章");
  }
  private async remote() {
    this.assertCurrent();
    const value = await this.client.json<RemoteSnapshot>(
      `/articles/${this.articleId}`,
    );
    this.assertCurrent();
    if (
      value.articleId !== this.articleId ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      typeof value.markdown !== "string" ||
      !value.metadata ||
      !Array.isArray(value.assets) ||
      value.assets.length > 125
    )
      throw new Error("服务器文章响应无效");
    return value;
  }
  async read(): Promise<ArticleSnapshot> {
    const value = await this.remote();
    const article = normalizeLegacyArticle({
      ...value.metadata,
      id: this.articleId,
      markdown: value.markdown,
    });
    const assets = [];
    const paths = new Set<string>();
    // 有界串行读取，任何一个资源版本冲突都丢弃整组结果。
    for (const asset of value.assets) {
      assertAssetPath(asset.path);
      if (
        paths.has(asset.path.toLowerCase()) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > 10 * 1024 * 1024
      )
        throw new Error("服务器资源清单无效");
      paths.add(asset.path.toLowerCase());
      const response = await this.client.request(
        `/articles/${this.articleId}/assets/${encodeURIComponent(asset.path.slice(6))}?revision=${value.revision}`,
      );
      if (
        !/^image\/(png|jpeg|webp|gif)(;|$)/.test(
          response.headers.get("content-type") ?? "",
        )
      )
        throw new Error("资源类型无效");
      const bytes = await response.blob();
      if (bytes.size !== asset.size || (await digest(bytes)) !== asset.sha256)
        throw new Error("资源摘要校验失败");
      this.assertCurrent();
      assets.push({ path: asset.path, bytes });
    }
    // 无图文章同样检查读取期间发生的更新。
    const latest = await this.remote();
    if (latest.revision !== value.revision)
      throw new ArticleStorageError("conflict", "读取期间文章版本变化，请重试");
    this.snapshot = { article, assets, revision: value.revision };
    this.pending = null;
    return this.snapshot;
  }
  recover() {
    return this.read();
  }
  async commit(
    content: ArticleContent,
    expectedRevision: number | null,
  ): Promise<ArticleSnapshot> {
    this.assertCurrent();
    validateContent(content, this.articleId);
    const assets = await Promise.all(
      content.assets.map(async (asset) => ({
        path: asset.path,
        sha256: await digest(asset.bytes),
        size: asset.bytes.size,
      })),
    );
    const { markdown, ...metadata } = content.article;
    const limits = this.client.capabilities?.limits;
    if (!limits) throw new Error("服务器能力尚未加载");
    const markdownBytes = new Blob([markdown]).size,
      metadataBytes = new Blob([JSON.stringify(metadata)]).size;
    if (
      markdownBytes > limits.markdownBytes ||
      metadataBytes > limits.metadataBytes ||
      assets.length > limits.assets ||
      assets.some((a) => a.size > limits.assetBytes) ||
      markdownBytes + metadataBytes + assets.reduce((n, a) => n + a.size, 0) >
        limits.articleBytes
    )
      throw new ArticleStorageError("capacity", "文章或资源超过服务器限制");
    // savedAt 是适配器生成的时间；同一次内容重试必须保留原时间与 multipart 字节。
    const key = JSON.stringify({
      markdown,
      metadata: { ...metadata, savedAt: undefined },
      assets,
    });
    if (this.pending?.rejected && this.pending.key !== key) this.pending = null;
    if (this.pending) {
      const same = this.pending.key === key;
      const resolved = await this.sendPending();
      if (same) return resolved;
      expectedRevision = resolved.revision;
    }
    if ((this.snapshot?.revision ?? null) !== expectedRevision)
      throw new ArticleStorageError(
        "conflict",
        "保存版本与已读快照不一致，请保留编辑后重新打开",
      );
    const operationId = crypto.randomUUID();
    const body = new FormData();
    const existing = new Map(
      await Promise.all(
        (this.snapshot?.assets ?? []).map(
          async (a) => [a.path, await digest(a.bytes)] as const,
        ),
      ),
    );
    const descriptors = assets.map((a, i) =>
      existing.get(a.path) === a.sha256 ? a : { ...a, partId: `asset${i}` },
    );
    // 只上传新增图片；重试复用同一清单，路径不可变由服务器再次校验。
    body.append(
      "manifest",
      JSON.stringify({
        operationId,
        expectedRevision,
        metadata,
        assets: descriptors,
      }),
    );
    body.append("markdown", new Blob([markdown]), "index.md");
    content.assets.forEach((asset, i) => {
      if ("partId" in descriptors[i])
        body.append(`asset${i}`, asset.bytes, `image${i}`);
    });
    this.pending = {
      key,
      operationId,
      expected: expectedRevision,
      content: {
        article: { ...content.article },
        assets: content.assets.map((a) => ({ ...a })),
      },
      body,
    };
    return this.sendPending();
  }
  private async sendPending() {
    this.assertCurrent();
    const pending = this.pending!;
    const receipt = await this.client
      .json<{
        articleId: string;
        operationId: string;
        committedRevision: number;
        kind: string;
      }>(`/articles/${this.articleId}`, { method: "PUT", body: pending.body })
      .catch((error) => {
        if (isDefiniteRejection(error)) pending.rejected = true;
        throw error;
      });
    this.assertCurrent();
    if (
      receipt.articleId !== this.articleId ||
      receipt.operationId !== pending.operationId ||
      receipt.kind !== "save" ||
      receipt.committedRevision !== (pending.expected ?? -1) + 1
    )
      throw new Error("服务器提交回执无效");
    const latest = await this.remote();
    if (latest.revision !== receipt.committedRevision)
      throw new ArticleStorageError(
        "conflict",
        "原操作已提交，但远端已有更新；当前编辑保留，请另存副本或重新读取",
      );
    this.snapshot = { ...pending.content, revision: receipt.committedRevision };
    this.pending = null;
    return this.snapshot;
  }
  async delete() {
    this.assertCurrent();
    if (!this.snapshot || this.pending)
      throw new ArticleStorageError(
        "conflict",
        "请先打开文章并解决未确认的保存，再删除",
      );
    this.deletion ??= {
      operationId: crypto.randomUUID(),
      expectedRevision: this.snapshot.revision,
    };
    const result = await this.client.json<{
      operationId: string;
      kind: string;
    }>(`/articles/${this.articleId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.deletion),
    });
    this.assertCurrent();
    if (
      result.kind !== "delete" ||
      result.operationId !== this.deletion.operationId
    )
      throw new Error("删除回执无效");
  }
}
