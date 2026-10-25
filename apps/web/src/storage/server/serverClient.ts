import { create } from "zustand";
import { getRuntimeConfig } from "./runtimeConfig";

export interface WorkspaceIdentity {
  deploymentId: string;
  workspaceEpoch: string;
  user: { userId: string; username: string; role: string };
  csrfToken: string;
}
export interface Capabilities {
  protocolVersion: 1;
  deploymentId: string;
  workspaceEpoch: string;
  ready: boolean;
  accountMode: "accounts";
  loginMethods: string[];
  limits: Record<string, number>;
}
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServerError";
  }
}
export function isDefiniteRejection(error: unknown) {
  return (
    error instanceof ServerError &&
    [400, 403, 404, 409, 413, 422, 429, 507].includes(error.status)
  );
}
export const useServerState = create<{
  status: "disabled" | "checking" | "anonymous" | "ready" | "offline" | "error";
  session: WorkspaceIdentity | null;
  message: string;
  generation: number;
  oidcNotice: string;
}>(() => ({
  status: "disabled",
  session: null,
  message: "",
  generation: 0,
  oidcNotice: "",
}));

export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
export function identityKey(session: WorkspaceIdentity) {
  return `${session.deploymentId}/${session.workspaceEpoch}/${session.user.userId}`;
}

export class ServerClient {
  capabilities: Capabilities | null = null;
  session: WorkspaceIdentity | null = null;
  generation = 0;
  private requests = new Set<AbortController>();
  private invalidators = new Set<() => void>();
  private checking: Promise<boolean> | null = null;
  private verified = false;
  constructor(
    readonly apiBase: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  onInvalidate(fn: () => void) {
    this.invalidators.add(fn);
    return () => {
      this.invalidators.delete(fn);
    };
  }
  invalidate() {
    this.generation++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.session = null;
    this.verified = false;
    this.checking = null;
    for (const fn of this.invalidators) fn();
    useServerState.setState({ session: null, generation: this.generation });
  }
  async request(
    path: string,
    init: RequestInit = {},
    privateRequest = true,
  ): Promise<Response> {
    if (privateRequest && !this.session)
      throw new ServerError(401, "session-required", "请先登录服务器工作区");
    if (privateRequest && !this.verified)
      throw new ServerError(
        503,
        "session-unverified",
        "请先重新验证服务器会话",
      );
    const generation = this.generation;
    const controller = new AbortController();
    this.requests.add(controller);
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      init.method === "PUT" ? 65000 : 15000,
    );
    const headers = new Headers(init.headers);
    if (init.method && init.method !== "GET" && this.session)
      headers.set("X-CSRF-Token", this.session.csrfToken);
    try {
      const source = await this.fetcher(`${this.apiBase}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      // 超时和体积上限覆盖整个响应体，防止只收到响应头后无限挂起。
      // JSON 对控制字符最多六倍转义；5 MiB 正文 + 1 MiB 元数据不能按原始字节截断。
      const maximum = path.includes("/assets/")
        ? 10 * 1024 * 1024
        : 32 * 1024 * 1024;
      const chunks: ArrayBuffer[] = [];
      let size = 0;
      const reader = source.body?.getReader();
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maximum) {
            await reader.cancel();
            throw new Error("服务器响应超过容量限制");
          }
          chunks.push(new Uint8Array(chunk.value).buffer);
        }
      }
      const response = new Response(
        source.status === 204 ? null : new Blob(chunks),
        { status: source.status, headers: source.headers },
      );
      if (generation !== this.generation)
        throw new Error("身份已变化，操作已取消");
      if (!response.ok) {
        let code = "http-error",
          message = `服务器请求失败（${response.status}）`;
        if (
          response.headers.get("content-type")?.includes("application/json")
        ) {
          const data = await response.json();
          if (typeof data?.error?.message === "string")
            message = data.error.message;
          if (typeof data?.error?.code === "string") code = data.error.code;
        }
        if (response.status === 401 && privateRequest) {
          this.invalidate();
          useServerState.setState({
            status: "anonymous",
            message: "会话已失效，请重新登录",
          });
        }
        throw new ServerError(response.status, code, message);
      }
      return response;
    } catch (error) {
      if (
        (timedOut || !(error instanceof ServerError)) &&
        generation === this.generation &&
        privateRequest
      ) {
        this.verified = false;
        useServerState.setState({
          status: "offline",
          message: timedOut
            ? "服务器请求超时，保存结果尚未确认，请保留编辑并重新连接"
            : "服务器连接中断，编辑仅保留在此页面，请下载抢救后重试",
        });
      }
      if (timedOut)
        throw new ServerError(
          504,
          "timeout",
          "服务器请求超时，请检查连接后重试",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }
  async json<T>(
    path: string,
    init?: RequestInit,
    privateRequest = true,
  ): Promise<T> {
    const generation = this.generation;
    const response = await this.request(path, init, privateRequest);
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new ServerError(
        502,
        "invalid-response",
        "服务器返回了非 JSON 内容，请检查 API 路由（可能是 HTML fallback）",
      );
    const value = await response.json();
    if (generation !== this.generation)
      throw new Error("身份已变化，操作已取消");
    return value as T;
  }
  private acceptSession(value: WorkspaceIdentity) {
    if (
      !uuid(value?.deploymentId) ||
      !uuid(value.workspaceEpoch) ||
      !uuid(value.user?.userId) ||
      typeof value.user.username !== "string" ||
      typeof value.csrfToken !== "string" ||
      !value.csrfToken
    )
      throw new Error("服务器会话响应无效");
    if (this.session && identityKey(this.session) !== identityKey(value))
      this.invalidate();
    this.session = value;
    this.verified = true;
    useServerState.setState({ status: "ready", session: value, message: "" });
  }
  connect(): Promise<boolean> {
    if (!this.checking) {
      const task = this.check();
      this.checking = task;
      void task.finally(() => {
        if (this.checking === task) this.checking = null;
      });
    }
    return this.checking;
  }
  private async check() {
    this.verified = false;
    useServerState.setState({
      status: "checking",
      message: "正在验证服务器会话…",
    });
    let generation = this.generation;
    try {
      const value = await this.json<Capabilities>(
        "/capabilities",
        undefined,
        false,
      );
      if (value.protocolVersion !== 1)
        throw new Error("服务器协议版本不兼容，需要 protocolVersion 1");
      if (
        !uuid(value.deploymentId) ||
        !uuid(value.workspaceEpoch) ||
        value.accountMode !== "accounts" ||
        !Array.isArray(value.loginMethods) ||
        value.loginMethods.length === 0 ||
        new Set(value.loginMethods).size !== value.loginMethods.length ||
        value.loginMethods.some(
          (method) => !["password", "radish-oidc"].includes(method),
        ) ||
        !value.limits ||
        [
          "markdownBytes",
          "metadataBytes",
          "assetBytes",
          "assets",
          "articleBytes",
          "articlesPerOwner",
        ].some(
          (key) =>
            !Number.isSafeInteger(value.limits[key]) || value.limits[key] <= 0,
        ) ||
        Object.values(value.limits).some(
          (v) => !Number.isSafeInteger(v) || v <= 0,
        )
      )
        throw new Error("服务器能力响应无效");
      if (
        this.session &&
        (this.session.deploymentId !== value.deploymentId ||
          this.session.workspaceEpoch !== value.workspaceEpoch)
      )
        this.invalidate();
      generation = this.generation;
      this.capabilities = value;
      if (value.ready !== true)
        throw new Error("服务器尚未就绪，请联系部署管理员");
      const session = await this.json<WorkspaceIdentity>(
        "/auth/session",
        undefined,
        false,
      );
      if (
        session.deploymentId !== value.deploymentId ||
        session.workspaceEpoch !== value.workspaceEpoch
      )
        throw new Error("工作区在验证期间发生变化，请重试");
      this.acceptSession(session);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      if (error instanceof ServerError && error.status === 401) {
        this.invalidate();
        useServerState.setState({
          status: "anonymous",
          message: "请登录服务器工作区",
        });
      } else
        useServerState.setState({
          status: this.session ? "offline" : "error",
          message: error instanceof Error ? error.message : String(error),
        });
      return false;
    }
  }
  async login(username: string, password: string) {
    if (!this.capabilities?.ready) throw new Error("请先连接可用的服务器");
    if (!this.capabilities.loginMethods.includes("password"))
      throw new Error("此部署未启用本地密码登录");
    const csrf = await this.json<{ csrfToken: string }>(
      "/auth/csrf",
      undefined,
      false,
    );
    const session = await this.json<WorkspaceIdentity>(
      "/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf.csrfToken,
        },
        body: JSON.stringify({ username, password }),
      },
      false,
    );
    if (
      session.deploymentId !== this.capabilities.deploymentId ||
      session.workspaceEpoch !== this.capabilities.workspaceEpoch
    )
      throw new Error("登录期间工作区身份发生变化，请重新连接");
    this.acceptSession(session);
  }
  async startOidc(purpose: "login" | "link"): Promise<string> {
    if (!this.capabilities?.loginMethods.includes("radish-oidc"))
      throw new Error("此部署未启用 Radish 登录");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (purpose === "login") {
      const csrf = await this.json<{ csrfToken: string }>(
        "/auth/csrf",
        undefined,
        false,
      );
      headers["X-CSRF-Token"] = csrf.csrfToken;
    }
    const result = await this.json<{ authorizationUrl: string }>(
      "/auth/oidc/radish/start",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ purpose }),
      },
      purpose === "link",
    );
    const url = new URL(result.authorizationUrl);
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          window.location.hostname === "127.0.0.1" &&
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1"
        ))
    )
      throw new Error("服务器返回的授权地址无效");
    return url.href;
  }
  async reauthenticate(password: string) {
    const session = await this.json<WorkspaceIdentity>("/auth/reauthenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    this.acceptSession(session);
  }
  async unlinkOidc() {
    await this.request("/auth/oidc/radish/unlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    this.invalidate();
    useServerState.setState({
      status: "anonymous",
      message: "已解除绑定并退出，请使用本地密码重新登录",
    });
  }
  async logout() {
    await this.request("/auth/logout", { method: "POST" });
    this.invalidate();
    useServerState.setState({
      status: "anonymous",
      message: "已退出服务器工作区",
    });
  }
}
let singleton: ServerClient | null = null;
export function getServerClient(): ServerClient {
  const config = getRuntimeConfig();
  if (config.deployment !== "server")
    throw new Error("此部署未启用服务器工作区");
  return (singleton ??= new ServerClient(config.apiBase));
}
