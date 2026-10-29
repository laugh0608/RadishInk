import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeOidcResult,
  navigateToOidc,
} from "../../storage/server/oidcNavigation";
import { initializeRuntimeConfig } from "../../storage/server/runtimeConfig";
import {
  ServerClient,
  useServerState,
} from "../../storage/server/serverClient";
import { broadcastSessionChange } from "../../storage/server/privateWorkspace";

vi.mock("../../storage/server/privateWorkspace", () => ({
  broadcastSessionChange: vi.fn(),
}));
function config(deployment: "static" | "server") {
  document.body.innerHTML =
    '<script id="radishink-runtime-config" type="application/json"></script>';
  document.getElementById("radishink-runtime-config")!.textContent =
    JSON.stringify(
      deployment === "static"
        ? { deployment }
        : { deployment, apiBase: "/api/v1" },
    );
  initializeRuntimeConfig(document);
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  useServerState.setState({ oidcNotice: "" });
  config("server");
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
  config("static");
});

describe("OIDC 跳转与回调", () => {
  it("保存失败不发起授权，异步授权期间编辑变化也不跳转", async () => {
    const client = new ServerClient("/api/v1"),
      navigate = vi.fn();
    const start = vi
      .spyOn(client, "startOidc")
      .mockResolvedValue("https://issuer.invalid/authorize");
    await expect(
      navigateToOidc(
        client,
        "login",
        () => Promise.reject(new Error("保存失败")),
        navigate,
      ),
    ).rejects.toThrow("保存失败");
    expect(start).not.toHaveBeenCalled();
    await expect(
      navigateToOidc(
        client,
        "link",
        () =>
          Promise.resolve(() => {
            throw new Error("稿件变化");
          }),
        navigate,
      ),
    ).rejects.toThrow("稿件变化");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("已保存且仍为同一稿件才跳转，传递授权用途", async () => {
    const client = new ServerClient("/api/v1"),
      navigate = vi.fn(),
      guard = vi.fn();
    const start = vi
      .spyOn(client, "startOidc")
      .mockResolvedValue("https://issuer.invalid/authorize?state=opaque");
    await navigateToOidc(
      client,
      "link",
      () => Promise.resolve(guard),
      navigate,
    );
    expect(start).toHaveBeenCalledWith("link");
    expect(guard).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      "https://issuer.invalid/authorize?state=opaque",
    );
  });
  it.each(["signed-in", "linked"])(
    "%s 回调移除业务 URL 标记并广播会话变化",
    (result) => {
      window.history.replaceState(
        { kept: true },
        "",
        `/?radishink-auth=${result}&keep=1`,
      );
      consumeOidcResult();
      expect(window.location.search).toBe("?keep=1");
      expect(window.history.state).toEqual({ kept: true });
      expect(broadcastSessionChange).toHaveBeenCalledOnce();
      expect(useServerState.getState().oidcNotice).toBeTruthy();
    },
  );
  it.each(["pending", "cancelled", "failed"])(
    "%s 不伪造登录成功或注销原身份",
    (result) => {
      window.history.replaceState({}, "", `/?radishink-auth=${result}`);
      consumeOidcResult();
      expect(broadcastSessionChange).not.toHaveBeenCalled();
      expect(useServerState.getState().oidcNotice).toBeTruthy();
      expect(window.location.search).toBe("");
    },
  );
  it("静态部署不消费服务器回调参数", () => {
    config("static");
    window.history.replaceState({}, "", "/?radishink-auth=signed-in");
    consumeOidcResult();
    expect(broadcastSessionChange).not.toHaveBeenCalled();
    expect(useServerState.getState().oidcNotice).toBe("");
  });
});
