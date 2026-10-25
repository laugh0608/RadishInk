// A stale deployment chunk must not force a reload of unsaved writing.
// The update boundary handles explicit consent, persistence and recovery.
export function installPreloadErrorHandler(deps: {
  target: Pick<EventTarget, "addEventListener">;
  requestReload: () => void;
}) {
  deps.target.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    deps.requestReload();
  });
}
