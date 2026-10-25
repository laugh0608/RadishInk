import { describe, expect, it, vi } from "vitest";
import { installPreloadErrorHandler } from "../../bootstrap/installPreloadErrorHandler";

describe("preload failure safety", () => {
  it("requests consent without refreshing, including repeated failures", () => {
    const target = new EventTarget();
    const requestReload = vi.fn();
    installPreloadErrorHandler({ target, requestReload });
    for (let i = 0; i < 3; i++) {
      const event = new Event("vite:preloadError", { cancelable: true });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(requestReload).toHaveBeenCalledTimes(3);
  });
});
