export const SAFE_RELOAD_EVENT = "radishink:safe-reload-request";
let requested = false;

export function requestSafeReload() {
  requested = true;
  window.dispatchEvent(new Event(SAFE_RELOAD_EVENT));
}

export function wasSafeReloadRequested() {
  return requested;
}
