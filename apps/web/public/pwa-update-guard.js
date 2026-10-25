/*
 * Imported before Workbox's default message listener. Even a legacy client
 * must not activate a worker through the unguarded SKIP_WAITING message.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.stopImmediatePropagation();
    return;
  }
  if (
    event.data?.type !== "RADISHINK_CHECK_UPDATE" &&
    event.data?.type !== "RADISHINK_ACTIVATE_UPDATE"
  )
    return;
  const port = event.ports?.[0];
  if (!port) return;
  event.waitUntil(
    (async () => {
      try {
        const clients = (
          await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          })
        ).filter((client) => client.url.startsWith(self.registration.scope));
        // Includes old clients which do not implement any tab-coordination API.
        if (clients.length !== 1 || clients[0].id !== event.source?.id) {
          port.postMessage({
            ok: false,
            error:
              "请先保存并关闭其他 RadishInk 页面或已安装应用窗口，再重试更新。",
          });
          return;
        }
        if (event.data.type === "RADISHINK_ACTIVATE_UPDATE")
          await self.skipWaiting();
        port.postMessage({ ok: true });
      } catch {
        port.postMessage({
          ok: false,
          error: "无法确认其他页面状态，尚未激活更新，请稍后重试。",
        });
      }
    })(),
  );
});
