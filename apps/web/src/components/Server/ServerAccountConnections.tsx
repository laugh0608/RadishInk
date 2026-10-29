import { useRef, useState } from "react";
import {
  getServerClient,
  useServerState,
} from "../../storage/server/serverClient";
import { broadcastSessionChange } from "../../storage/server/privateWorkspace";
import { navigateToOidc } from "../../storage/server/oidcNavigation";
import { saveBeforeUpdate } from "../../pwa/saveBeforeUpdate";
import { useStorageContext } from "../../storage/StorageContext";
import { useFileSystem } from "../../hooks/useFileSystem";

export function ServerAccountConnections({ disabled }: { disabled: boolean }) {
  const context = useStorageContext();
  const contextRef = useRef(context);
  contextRef.current = context;
  const { persistActiveFile } = useFileSystem();
  const client = getServerClient();
  const notice = useServerState((state) => state.oidcNotice);
  const [methods, setMethods] = useState<{
    hasPassword: boolean;
    linked: boolean;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!client.capabilities?.loginMethods.includes("radish-oidc")) return null;
  const passwordEnabled = client.capabilities.loginMethods.includes("password");
  async function act(unlink: boolean) {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      const guard = await saveBeforeUpdate(
        () => contextRef.current,
        persistActiveFile,
      );
      await client.reauthenticate(password);
      setPassword("");
      broadcastSessionChange();
      guard();
      if (unlink) {
        if (!confirmed) throw new Error("请先确认解除绑定");
        await client.unlinkOidc();
        broadcastSessionChange();
      } else await navigateToOidc(client, "link", () => Promise.resolve(guard));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <>
      {notice && <p role="status">{notice}</p>}
      <details
        className="server-account-connections"
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          setMethods(null);
          setError("");
          setBusy(true);
          void client
            .json<{ hasPassword: boolean; linked: boolean }>(
              "/auth/oidc/radish/identity",
            )
            .then(setMethods)
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <summary>账号登录方式</summary>
        {methods && (
          <>
            <p>
              {methods.linked
                ? "已绑定 Radish。退出按钮仅退出本站。"
                : "尚未绑定 Radish。绑定后可用两种方式打开同一份服务器文章。"}
            </p>
            {passwordEnabled && methods.hasPassword ? (
              <>
                <label>
                  验证本站密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    maxLength={1024}
                    disabled={busy || disabled}
                  />
                </label>
                {methods.linked ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      解除绑定并退出本站，之后使用本地密码登录
                    </label>
                    <button
                      disabled={busy || disabled || !password || !confirmed}
                      onClick={() => void act(true)}
                    >
                      验证并解除 Radish 绑定
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy || disabled || !password}
                    onClick={() => void act(false)}
                  >
                    验证并绑定 Radish
                  </button>
                )}
              </>
            ) : (
              <p>
                当前没有可用的本地密码登录方式，不能解除唯一的登录方式。需要恢复时请联系部署管理员。
              </p>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </details>
    </>
  );
}
