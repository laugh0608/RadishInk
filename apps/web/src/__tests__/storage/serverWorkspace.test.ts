// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../../storage/server/runtimeConfig";
import {
  ServerClient,
  useServerState,
  type WorkspaceIdentity,
} from "../../storage/server/serverClient";
import { ServerArticleStore } from "../../storage/server/ServerArticleStore";
import { ServerStorageAdapter } from "../../storage/adapters/ServerStorageAdapter";
import {
  digest,
  type ArticleContent,
} from "../../storage/articles/articleContract";

const deploymentId = "10000000-0000-4000-8000-000000000001";
const workspaceEpoch = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const articleId = "40000000-0000-4000-8000-000000000001";
const session = (): WorkspaceIdentity => ({
  deploymentId,
  workspaceEpoch,
  user: { userId, username: "synthetic", role: "member" },
  csrfToken: "synthetic-csrf",
});
const capabilities = () => ({
  deploymentId,
  workspaceEpoch,
  protocolVersion: 1,
  accountMode: "accounts",
  ready: true,
  loginMethods: ["password"],
  limits: {
    markdownBytes: 5 * 1024 * 1024,
    metadataBytes: 1024 * 1024,
    assetBytes: 10 * 1024 * 1024,
    assets: 125,
    articleBytes: 64 * 1024 * 1024,
    articlesPerOwner: 1000,
  },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const content = (
  markdown = "\ufeff---\r\nunknown: retained\r\n---\r\n# 合成正文\r\n",
): ArticleContent => ({
  article: {
    id: articleId,
    markdown,
    title: "合成文章",
    theme: "default",
    themeName: "默认主题",
    customCSS: "",
    createdAt: "2026-10-25T01:00:00.000Z",
    savedAt: "2026-10-25T01:00:00.000Z",
    ...{ unknown: "preserve" },
  },
  assets: [],
});

/** 协议替身只模拟网络丢响应和版本变化；仓储 / 鉴权实现在服务端真实 HTTP 测试验证。 */
function backend() {
  let identity = session();
  let revision = -1;
  let saved: ArticleContent | null = null;
  const receipts = new Map<
    string,
    {
      operationId: string;
      articleId: string;
      committedRevision: number;
      kind: string;
    }
  >();
  let loseResponse = false;
  let rejection = 0;
  let assetConflict = false;
  const writes: { manifest: Record<string, unknown>; body: FormData }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/capabilities"))
      return json({
        ...capabilities(),
        deploymentId: identity.deploymentId,
        workspaceEpoch: identity.workspaceEpoch,
      });
    if (url.endsWith("/auth/session")) return json(identity);
    if (url.endsWith("/auth/logout"))
      return new Response(null, { status: 204 });
    if (init?.method === "PUT") {
      const body = init.body as FormData;
      const manifest = JSON.parse(body.get("manifest") as string);
      writes.push({ manifest, body });
      if (rejection) {
        const status = rejection;
        rejection = 0;
        return json(
          { error: { code: "invalid", message: "合成拒绝" } },
          status,
        );
      }
      let receipt = receipts.get(manifest.operationId);
      if (!receipt) {
        if (manifest.expectedRevision !== (revision < 0 ? null : revision))
          return json(
            { error: { code: "conflict", message: "版本冲突" } },
            409,
          );
        const assets = [];
        for (const a of manifest.assets) {
          const bytes = a.partId
            ? (body.get(a.partId) as Blob)
            : saved!.assets.find((b) => b.path === a.path)!.bytes;
          assets.push({ path: a.path, bytes });
        }
        saved = {
          article: {
            ...manifest.metadata,
            markdown: new TextDecoder("utf-8", { ignoreBOM: true }).decode(
              await (body.get("markdown") as Blob).arrayBuffer(),
            ),
          },
          assets,
        };
        revision++;
        receipt = {
          operationId: manifest.operationId,
          articleId: manifest.metadata.id,
          committedRevision: revision,
          kind: "save",
        };
        receipts.set(receipt.operationId, receipt);
      }
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError("synthetic connection lost after commit");
      }
      return json(receipt);
    }
    if (url.includes("/assets/")) {
      if (assetConflict)
        return json(
          { error: { code: "conflict", message: "资源版本变化" } },
          409,
        );
      return new Response(saved!.assets[0].bytes, {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url.includes("/articles?"))
      return json(
        saved
          ? [
              {
                id: saved.article.id,
                title: saved.article.title,
                savedAt: saved.article.savedAt,
                revision,
              },
            ]
          : [],
      );
    if (url.includes("/articles/")) {
      const { markdown, ...metadata } = saved!.article;
      return json({
        articleId: saved!.article.id,
        revision,
        markdown,
        metadata,
        assets: await Promise.all(
          saved!.assets.map(async (a) => ({
            path: a.path,
            size: a.bytes.size,
            sha256: await digest(a.bytes),
          })),
        ),
      });
    }
    throw new Error(`unexpected request: ${url}`);
  });
  const client = new ServerClient("/api/v1", fetcher);
  return {
    client,
    fetcher,
    writes,
    get saved() {
      return saved;
    },
    get revision() {
      return revision;
    },
    setIdentity(next: WorkspaceIdentity) {
      identity = next;
    },
    loseNext() {
      loseResponse = true;
    },
    rejectNext(status: number) {
      rejection = status;
    },
    advance() {
      revision++;
    },
    conflictAssets() {
      assetConflict = true;
    },
  };
}

beforeEach(() => {
  useServerState.setState({
    status: "disabled",
    session: null,
    message: "",
    generation: 0,
  });
});

describe("运行时配置与能力发现", () => {
  it("静态配置无 API 地址；服务器地址固定在部署子目录内", () => {
    expect(
      parseRuntimeConfig(
        { deployment: "static" },
        "https://example.test/nested/",
      ),
    ).toEqual({ deployment: "static" });
    expect(
      parseRuntimeConfig(
        { deployment: "server", apiBase: "/nested/api/v1" },
        "https://example.test/nested/index.html",
      ),
    ).toEqual({ deployment: "server", apiBase: "/nested/api/v1" });
  });
  it.each([
    "https://evil.test/api/v1",
    "//evil.test/api/v1",
    "/api/v1",
    "/nested/../api/v1",
    "/nested/api/v1?x=1",
    "/nested/api/v2",
    "/nested/%61pi/v1",
  ])("拒绝越界或非规范地址 %s", (apiBase) => {
    expect(() =>
      parseRuntimeConfig(
        { deployment: "server", apiBase },
        "https://example.test/nested/",
      ),
    ).toThrow();
  });
  it.each([
    null,
    {},
    { deployment: "static", apiBase: "/api/v1" },
    { deployment: "unknown" },
  ])("损坏配置明确拒绝 %j", (value) => {
    expect(() => parseRuntimeConfig(value, "https://example.test/")).toThrow();
  });
  it.each([
    [
      () =>
        new Response("<html>fallback</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      "非 JSON",
    ],
    [() => json({ ...capabilities(), protocolVersion: 2 }), "协议版本"],
    [() => json({ ...capabilities(), ready: false }), "尚未就绪"],
    [
      () => json({ ...capabilities(), deploymentId: "invalid" }),
      "能力响应无效",
    ],
    [() => json({ ...capabilities(), limits: {} }), "能力响应无效"],
  ] as const)("错误能力不会启用适配器", async (response, message) => {
    const client = new ServerClient(
      "/api/v1",
      vi.fn(async () => response()),
    );
    expect(await client.connect()).toBe(false);
    expect(client.session).toBeNull();
    expect(useServerState.getState().message).toContain(message);
  });
  it("未登录保持明确身份门禁，不把 401 当空文章列表", async () => {
    const client = new ServerClient(
      "/api/v1",
      vi.fn(async (input) =>
        String(input).endsWith("capabilities")
          ? json(capabilities())
          : json({ error: { message: "未登录", code: "unauthorized" } }, 401),
      ),
    );
    expect(await client.connect()).toBe(false);
    expect(useServerState.getState().status).toBe("anonymous");
    await expect(client.json("/articles")).rejects.toMatchObject({
      status: 401,
    });
  });
  it("所有请求带同源凭据、no-store，写入附会话 CSRF", async () => {
    const mock = backend();
    await mock.client.connect();
    await mock.client.logout();
    for (const [, init] of mock.fetcher.mock.calls)
      expect(init).toMatchObject({
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
    expect(
      new Headers(mock.fetcher.mock.calls.at(-1)![1]?.headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("synthetic-csrf");
  });
  it("能力发现超时可诊断且不启用工作区", async () => {
    vi.useFakeTimers();
    try {
      const client = new ServerClient(
        "/api/v1",
        vi.fn<typeof fetch>(
          (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init!.signal!.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
      );
      const task = client.connect();
      await vi.advanceTimersByTimeAsync(15000);
      expect(await task).toBe(false);
      expect(useServerState.getState().message).toContain("超时");
      expect(client.session).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("身份变化后丢弃已发出的迟到私有响应", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("capabilities")) return json(capabilities());
      if (String(input).endsWith("session")) return json(session());
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const client = new ServerClient("/api/v1", fetcher);
    await client.connect();
    const task = client.json("/articles");
    client.invalidate();
    finish(json([{ private: "old-user" }]));
    await expect(task).rejects.toThrow("身份已变化");
    expect(client.session).toBeNull();
  });
});

describe("服务器文章完整快照与失败保护", () => {
  it("明确拒绝后允许修正内容重新提交，不无限重试已经无效的请求", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId);
    mock.rejectNext(422);
    await expect(store.commit(content("bad"), null)).rejects.toMatchObject({
      status: 422,
    });
    await store.commit(content("corrected"), null);
    expect(mock.saved?.article.markdown).toBe("corrected");
    expect(mock.writes).toHaveLength(2);
    expect(mock.writes[0].manifest.operationId).not.toBe(
      mock.writes[1].manifest.operationId,
    );
  });
  it("新建明确被拒绝后可重新导入修正后的文章", async () => {
    const mock = backend(),
      adapter = new ServerStorageAdapter(mock.client);
    await adapter.init();
    mock.rejectNext(422);
    await expect(adapter.createArticle("bad", "old")).rejects.toThrow(
      "合成拒绝",
    );
    await expect(adapter.createArticle("corrected", "new")).resolves.toMatch(
      /index\.md$/,
    );
    expect(mock.saved?.article.markdown).toBe("corrected");
  });
  it("新建丢响应后从列表打开确认可解除待确认状态", async () => {
    const mock = backend(),
      adapter = new ServerStorageAdapter(mock.client);
    await adapter.init();
    mock.loseNext();
    await expect(adapter.createArticle("first", "first")).rejects.toThrow();
    await mock.client.connect();
    const path = (await adapter.listFiles())[0].path;
    await adapter.readFile(path);
    // 替身只保存一篇文章，此处检查确实尝试新的 ID，而非被旧待确认状态阻止。
    mock.rejectNext(422);
    await expect(adapter.createArticle("second", "second")).rejects.toThrow(
      "合成拒绝",
    );
    expect(mock.writes[0].manifest.metadata).not.toEqual(
      mock.writes[1].manifest.metadata,
    );
  });
  it("保留原始 BOM / CRLF 与未知元数据，读取、图片与后续正文保存形成完整快照", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId),
      input = content();
    input.assets = [
      {
        path: "asset/synthetic.png",
        bytes: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      },
    ];
    await store.commit(input, null);
    const read = await store.read();
    expect(read.article.markdown).toBe(input.article.markdown);
    expect(read.article).toHaveProperty("unknown", "preserve");
    expect(await read.assets[0].bytes.arrayBuffer()).toEqual(
      await input.assets[0].bytes.arrayBuffer(),
    );
    await store.commit(
      { ...read, article: { ...read.article, markdown: "changed" } },
      read.revision,
    );
    expect(mock.writes[1].body.has("asset0")).toBe(false);
    expect(mock.writes[1].manifest).toHaveProperty("expectedRevision", 0);
  });
  it("提交后丢响应重试复用 operationId，先解决旧提交再保存后续输入", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId);
    mock.loseNext();
    await expect(store.commit(content("first"), null)).rejects.toThrow(
      "connection lost",
    );
    expect(mock.revision).toBe(0);
    expect(useServerState.getState().status).toBe("offline");
    await mock.client.connect();
    const saved = await store.commit(content("later edit"), null);
    expect(mock.writes).toHaveLength(3);
    expect(mock.writes[0].manifest.operationId).toBe(
      mock.writes[1].manifest.operationId,
    );
    expect(mock.writes[2].manifest.operationId).not.toBe(
      mock.writes[0].manifest.operationId,
    );
    expect(saved.revision).toBe(1);
    expect(saved.article.markdown).toBe("later edit");
  });
  it("旧幂等回执已落后于远端时保留编辑并冲突，不追读版本强写", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId);
    mock.loseNext();
    await expect(store.commit(content(), null)).rejects.toThrow();
    mock.advance();
    await mock.client.connect();
    await expect(store.commit(content(), null)).rejects.toThrow("远端已有更新");
    expect(mock.writes).toHaveLength(2);
    expect(mock.writes[1].manifest.expectedRevision).toBeNull();
  });
  it("保存使用已读版本，409 不覆盖远端也不改变本地快照", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId);
    await store.commit(content(), null);
    mock.advance();
    await expect(store.commit(content("unsaved"), 0)).rejects.toMatchObject({
      status: 409,
    });
    expect(mock.writes.at(-1)!.manifest.expectedRevision).toBe(0);
    expect(store.snapshot?.revision).toBe(0);
    expect(store.snapshot?.article.markdown).not.toBe("unsaved");
  });
  it("图片读取版本变化不产生部分资源快照", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId),
      input = content();
    input.assets = [{ path: "asset/a.png", bytes: new Blob(["image"]) }];
    await store.commit(input, null);
    mock.conflictAssets();
    const fresh = new ServerArticleStore(mock.client, articleId);
    await expect(fresh.read()).rejects.toMatchObject({ status: 409 });
    expect(fresh.snapshot).toBeNull();
  });
  it("新建丢响应后保持 UUID 和 createdAt，同内容不会重复创建", async () => {
    const mock = backend(),
      adapter = new ServerStorageAdapter(mock.client);
    await adapter.init();
    mock.loseNext();
    await expect(adapter.createArticle("# 合成", "合成")).rejects.toThrow();
    await mock.client.connect();
    const path = await adapter.createArticle("# 合成", "合成");
    expect(mock.writes[0].manifest.operationId).toBe(
      mock.writes[1].manifest.operationId,
    );
    expect(mock.writes[0].manifest.metadata).toEqual(
      mock.writes[1].manifest.metadata,
    );
    expect(path).toBe(`${mock.saved!.article.id}/index.md`);
    expect(mock.revision).toBe(0);
  });
  it("换账号或恢复 epoch 后清除适配器快照，旧实例拒绝继续访问", async () => {
    const mock = backend(),
      adapter = new ServerStorageAdapter(mock.client);
    await adapter.init();
    const path = await adapter.createArticle("# A", "A");
    const old = new ServerArticleStore(mock.client, mock.saved!.article.id);
    const before = adapter.getWorkspaceIdentity();
    mock.setIdentity({
      ...session(),
      workspaceEpoch: "20000000-0000-4000-8000-000000000002",
    });
    await mock.client.connect();
    expect(adapter.getWorkspaceIdentity()).not.toBe(before);
    expect(() => adapter.getArticleAssets(path)).toThrow("快照");
    await expect(old.read()).rejects.toThrow("身份已变化");
  });
  it("超限文章在上传前拒绝，任意路径不触发服务器读取", async () => {
    const mock = backend(),
      adapter = new ServerStorageAdapter(mock.client);
    await adapter.init();
    await expect(adapter.readFile("../other/index.md")).rejects.toThrow(
      "路径无效",
    );
    const store = new ServerArticleStore(mock.client, articleId);
    await expect(
      store.commit(content("x".repeat(5 * 1024 * 1024 + 1)), null),
    ).rejects.toThrow("超过服务器限制");
    expect(mock.writes).toHaveLength(0);
  });
  it("JSON 转义放大的合法满额正文仍能读取，不误用原始字节上限截断", async () => {
    const mock = backend();
    await mock.client.connect();
    const store = new ServerArticleStore(mock.client, articleId);
    const markdown = "\t".repeat(5 * 1024 * 1024);
    await store.commit(content(markdown), null);
    expect((await store.read()).article.markdown).toBe(markdown);
  });
});

it("仅 OIDC 与双登录能力有效，密码关闭时不发送密码请求", async () => {
  for (const loginMethods of [["radish-oidc"], ["password", "radish-oidc"]]) {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/capabilities")
        ? json({ ...capabilities(), loginMethods })
        : json({ error: { code: "unauthorized" } }, 401),
    );
    const client = new ServerClient("/api/v1", fetcher);
    expect(await client.connect()).toBe(false);
    expect(useServerState.getState().status).toBe("anonymous");
    expect(client.capabilities?.loginMethods).toEqual(loginMethods);
    if (!loginMethods.includes("password")) {
      await expect(
        client.login("synthetic", "synthetic-password"),
      ).rejects.toThrow("未启用本地密码");
      expect(fetcher.mock.calls).toHaveLength(2);
    }
  }
});
it.each(
  [[], ["password", "password"], ["unknown"]].map((loginMethods) => ({
    loginMethods,
  })),
)("拒绝无效登录能力 $loginMethods", async ({ loginMethods: methods }) => {
  const client = new ServerClient("/api/v1", async () =>
    json({ ...capabilities(), loginMethods: methods }),
  );
  expect(await client.connect()).toBe(false);
  expect(useServerState.getState().status).toBe("error");
});

describe("P4-3 共享工作区", () => {
  it("共享能力不伪装登录，所有文章请求带 epoch；服务端拒绝旧页面时清除工作区", async () => {
    const sharedSession = {
      ...session(),
      accountMode: "shared",
      user: {
        userId: "00000000-0000-4000-8000-000000000001",
        username: "共享工作区",
        role: "shared",
      },
    };
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/capabilities"))
        return json({
          ...capabilities(),
          accountMode: "shared",
          loginMethods: [],
        });
      if (String(url).endsWith("/auth/session")) return json(sharedSession);
      expect(new Headers(init?.headers).get("X-RadishInk-Workspace")).toBe(
        `${deploymentId}/${workspaceEpoch}`,
      );
      return json(
        { error: { code: "workspace-changed", message: "工作区已变化" } },
        409,
      );
    });
    const client = new ServerClient("/api/v1", fetcher);
    const invalidated = vi.fn();
    client.onInvalidate(invalidated);
    expect(await client.connect()).toBe(true);
    await expect(client.login("alice", "unused")).rejects.toThrow("未启用");
    await expect(client.logout()).rejects.toThrow("没有用户登录");
    await expect(client.json("/articles")).rejects.toMatchObject({
      code: "workspace-changed",
    });
    expect(client.session).toBeNull();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    { accountMode: "shared", loginMethods: ["password"] },
    { accountMode: "accounts", loginMethods: [] },
  ])("拒绝矛盾能力 %j", async (patch) => {
    const client = new ServerClient(
      "/api/v1",
      vi.fn(async () => json({ ...capabilities(), ...patch })),
    );
    expect(await client.connect()).toBe(false);
    expect(client.session).toBeNull();
  });
  it("共享模式拒绝由普通用户会话冒充固定工作区", async () => {
    const client = new ServerClient(
      "/api/v1",
      vi.fn(async (url) =>
        String(url).endsWith("/capabilities")
          ? json({ ...capabilities(), accountMode: "shared", loginMethods: [] })
          : json({ ...session(), accountMode: "shared" }),
      ),
    );
    expect(await client.connect()).toBe(false);
    expect(client.session).toBeNull();
  });
});
