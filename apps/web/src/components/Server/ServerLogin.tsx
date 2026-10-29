import { useEffect, useState } from "react";
import {
  getServerClient,
  useServerState,
} from "../../storage/server/serverClient";
import { broadcastSessionChange } from "../../storage/server/privateWorkspace";
import "./ServerWorkspace.css";
import { navigateToOidc } from "../../storage/server/oidcNavigation";

export function ServerLogin({
  beforeRedirect,
}: {
  beforeRedirect?: () => Promise<() => void>;
}) {
  const { status, session, message, oidcNotice } = useServerState();
  const client = getServerClient();
  const passwordEnabled =
    client.capabilities?.loginMethods.includes("password") ?? true;
  const oidcEnabled =
    client.capabilities?.loginMethods.includes("radish-oidc") ?? false;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (useServerState.getState().status === "disabled")
      void getServerClient().connect();
  }, []);
  if (client.capabilities?.accountMode === "shared")
    return (
      <div className="server-login">
        <h2>共享服务器工作区 · 无用户隔离</h2>
        <p>
          任何能访问此服务器的人都可以读取、修改和删除共享文章。浏览器草稿不会自动上传。
        </p>
        <p>{message}</p>
        <button
          type="button"
          disabled={status === "checking"}
          onClick={() => void client.connect()}
        >
          重新连接
        </button>
      </div>
    );
  if (session) return <p>已登录：{session.user.username}</p>;
  return (
    <form
      className="server-login"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await getServerClient().login(username, password);
          broadcastSessionChange();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setPassword("");
          setBusy(false);
        }
      }}
    >
      <h2>服务器工作区</h2>
      <p>{message || "使用部署管理员提供的本站账号登录。"}</p>
      {oidcNotice && <p role="status">{oidcNotice}</p>}
      {passwordEnabled && (
        <>
          <label>
            用户名
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              maxLength={64}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={1024}
            />
          </label>
          <button type="submit" disabled={busy || status !== "anonymous"}>
            {busy ? "登录中…" : "登录"}
          </button>
        </>
      )}
      {oidcEnabled && (
        <button
          type="button"
          disabled={busy || status !== "anonymous"}
          onClick={() => {
            setBusy(true);
            setError("");
            void navigateToOidc(
              client,
              "login",
              beforeRedirect ?? (() => Promise.resolve(() => {})),
            )
              .catch((cause) =>
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          使用 Radish 登录
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy || status === "checking"}
        onClick={() => void getServerClient().connect()}
      >
        重新连接
      </button>
    </form>
  );
}
