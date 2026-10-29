import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { useStorageContext } from "../../storage/StorageContext";
import { getRuntimeConfig } from "../../storage/server/runtimeConfig";
import {
  getServerClient,
  useServerState,
} from "../../storage/server/serverClient";
import {
  clearPrivateWorkspace,
  listenSessionChange,
  downloadServerRescue,
} from "../../storage/server/privateWorkspace";
import { ServerLogin } from "./ServerLogin";
import "./ServerWorkspace.css";

export function ServerWorkspaceBoundary({ children }: { children: ReactNode }) {
  const { type, select } = useStorageContext();
  const { status, session, message, generation } = useServerState();
  const enabled = getRuntimeConfig().deployment === "server";
  const privateMode = enabled && type === "server";
  useEffect(() => {
    if (!enabled) return;
    const client = getServerClient();
    const clear = client.onInvalidate(() => {
      if (privateMode) clearPrivateWorkspace();
    });
    const mask = () => {
      if (privateMode)
        document.documentElement.setAttribute(
          "data-private-workspace-masked",
          "true",
        );
    };
    const verify = () => {
      mask();
      void client.connect();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") verify();
      else mask();
    };
    // 广播已证明本站会话发生了变化；即使旧标签断网，也必须立即清理旧私有快照。
    const unlisten = listenSessionChange(() => {
      mask();
      client.invalidate();
      void client.connect();
    });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", verify);
    window.addEventListener("pagehide", mask);
    window.addEventListener("online", verify);
    return () => {
      clear();
      unlisten();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", verify);
      window.removeEventListener("pagehide", mask);
      window.removeEventListener("online", verify);
      document.documentElement.removeAttribute("data-private-workspace-masked");
    };
  }, [enabled, privateMode]);
  useLayoutEffect(() => {
    if (status === "ready" || !privateMode)
      document.documentElement.removeAttribute("data-private-workspace-masked");
    else
      document.documentElement.setAttribute(
        "data-private-workspace-masked",
        "true",
      );
  }, [status, privateMode, session]);
  const masked = privateMode && status !== "ready";
  return (
    <>
      <div
        key={privateMode ? generation : "local"}
        className={privateMode ? "server-private-view" : undefined}
        hidden={masked}
      >
        {children}
      </div>
      {masked && (
        <div
          className="server-session-gate"
          role="region"
          aria-label="服务器会话"
        >
          {session ? (
            <div className="server-login">
              <h2>工作区暂不可用</h2>
              <p role="alert">{message}</p>
              <p>当前编辑仍在此页面内存中；纯 Markdown 抢救不含图片。</p>
              <button onClick={downloadServerRescue}>下载当前正文</button>
              <button
                disabled={status === "checking"}
                onClick={() => void getServerClient().connect()}
              >
                重新验证会话
              </button>
            </div>
          ) : (
            <>
              <ServerLogin />
              <button
                className="server-local-mode"
                onClick={() => void select("indexeddb")}
              >
                使用浏览器存储
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
