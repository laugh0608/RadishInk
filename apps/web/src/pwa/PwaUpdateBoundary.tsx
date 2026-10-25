import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useStorageContext } from "../storage/StorageContext";
import { useFileSystem } from "../hooks/useFileSystem";
import { platform } from "../lib/platformAdapter";
import { MarkdownTransferContext } from "../components/Files/markdownTransferContext";
import { Modal } from "../components/common/Modal";
import { assertUpdateIdle, saveBeforeUpdate } from "./saveBeforeUpdate";
import {
  watchPwaUpdates,
  withUpdateTimeout,
  type UpdateNotice,
} from "./updateClient";
import { SAFE_RELOAD_EVENT, wasSafeReloadRequested } from "./safeReloadRequest";
import "./PwaUpdateBoundary.css";

export function PwaUpdateBoundary({ children }: { children: ReactNode }) {
  const context = useStorageContext();
  const contextRef = useRef(context);
  contextRef.current = context;
  const { persistActiveFile } = useFileSystem();
  const transfer = useContext(MarkdownTransferContext);
  const [notice, setNotice] = useState<UpdateNotice>({
    available: false,
    error: "",
  });
  const [reloadRequired, setReloadRequired] = useState(wasSafeReloadRequested);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const clientRef = useRef<ReturnType<typeof watchPwaUpdates> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const request = () => {
      setReloadRequired(true);
      setCollapsed(false);
    };
    window.addEventListener(SAFE_RELOAD_EVENT, request);
    let stop = () => {};
    if (
      import.meta.env.PROD &&
      !platform.isElectron &&
      "serviceWorker" in navigator
    ) {
      const client = watchPwaUpdates(
        navigator.serviceWorker,
        new URL(import.meta.env.BASE_URL, document.baseURI),
        setNotice,
      );
      clientRef.current = client;
      const check = () => {
        void client.check();
      };
      const visible = () => {
        if (document.visibilityState === "visible") check();
      };
      const timer = window.setInterval(check, 60 * 60 * 1000);
      window.addEventListener("online", check);
      document.addEventListener("visibilitychange", visible);
      stop = () => {
        client.dispose();
        clearInterval(timer);
        window.removeEventListener("online", check);
        document.removeEventListener("visibilitychange", visible);
        clientRef.current = null;
      };
    }
    return () => {
      mounted.current = false;
      window.removeEventListener(SAFE_RELOAD_EVENT, request);
      stop();
    };
  }, []);

  const update = async () => {
    if (busyRef.current) return;
    setError("");
    try {
      assertUpdateIdle(contextRef.current);
      busyRef.current = true;
      if (contentRef.current) contentRef.current.inert = true;
      setBusy(true);
      const client = clientRef.current;
      const worker = await withUpdateTimeout(
        Promise.resolve(client?.prepare(reloadRequired)),
        "更新检查等待超时，当前页面已保留，请稍后重试。",
      );
      if (!client && !reloadRequired)
        throw new Error("更新程序尚未就绪，请稍后重试。");
      const assertCurrent = await withUpdateTimeout(
        saveBeforeUpdate(() => contextRef.current, persistActiveFile),
        "保存等待超时，尚未激活更新；当前输入已保留，请确认保存状态后重试。",
      );
      if (!mounted.current) return;
      assertCurrent();
      await client?.activate(worker);
      if (!mounted.current) return;
      assertCurrent();
      window.location.reload();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (contentRef.current) contentRef.current.inert = false;
      if (mounted.current) setBusy(false);
    }
  };

  const visible =
    !platform.isElectron &&
    (notice.available || notice.error || reloadRequired);
  return (
    <>
      <div ref={contentRef} className="pwa-app-content">
        {children}
      </div>
      {visible && !busy && (
        <aside className="pwa-update-notice" aria-label="应用更新">
          {collapsed ? (
            <button type="button" onClick={() => setCollapsed(false)}>
              {notice.available ? "有新版本，查看更新" : "查看更新提示"}
            </button>
          ) : (
            <>
              <strong>
                {reloadRequired
                  ? "页面资源需要重新加载"
                  : notice.available
                    ? "新版本已准备好"
                    : "更新检查未完成"}
              </strong>
              <p>
                确认后会先保存当前文章再刷新。请先结束图片和文件操作，并保存、关闭其他
                RadishInk 页面。
              </p>
              {(error || notice.error) && (
                <p role="alert">{error || notice.error}</p>
              )}
              <div className="pwa-update-actions">
                {(notice.available || reloadRequired) && (
                  <button type="button" onClick={() => void update()}>
                    保存并更新
                  </button>
                )}
                {notice.error && (
                  <button
                    type="button"
                    onClick={() => void clientRef.current?.check(true)}
                  >
                    重新检查
                  </button>
                )}
                {error && transfer && (
                  <button
                    type="button"
                    disabled={transfer.importing}
                    onClick={transfer.exportFile}
                  >
                    导出正文（仅文本）
                  </button>
                )}
                <button type="button" onClick={() => setCollapsed(true)}>
                  稍后
                </button>
              </div>
            </>
          )}
        </aside>
      )}
      <Modal
        open={busy}
        onClose={() => {}}
        closeDisabled
        title="正在安全更新"
        description="正在保存文章并切换版本，请稍候。失败时会保留当前输入。"
      >
        <p role="status">正在保存与检查更新…</p>
      </Modal>
    </>
  );
}
