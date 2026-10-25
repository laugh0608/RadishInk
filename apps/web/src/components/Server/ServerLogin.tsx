import { useEffect, useState } from "react";
import {
  getServerClient,
  useServerState,
} from "../../storage/server/serverClient";
import { broadcastSessionChange } from "../../storage/server/privateWorkspace";
import "./ServerWorkspace.css";

export function ServerLogin() {
  const { status, session, message } = useServerState();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (useServerState.getState().status === "disabled")
      void getServerClient().connect();
  }, []);
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
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy || status !== "anonymous"}>
        {busy ? "登录中…" : "登录"}
      </button>
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
