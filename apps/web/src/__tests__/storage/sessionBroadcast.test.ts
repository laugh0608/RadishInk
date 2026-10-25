import { afterEach, expect, it, vi } from "vitest";
import {
  broadcastSessionChange,
  listenSessionChange,
} from "../../storage/server/privateWorkspace";

afterEach(() => vi.unstubAllGlobals());

it("本页通知不清空自己的工作区，其他标签和旧版本通知仍触发验证", () => {
  const channels = new Set<FakeChannel>();
  class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor() {
      channels.add(this);
    }
    postMessage(data: unknown) {
      for (const channel of channels)
        if (channel !== this) channel.onmessage?.({ data } as MessageEvent);
    }
    close() {
      channels.delete(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  const listener = vi.fn();
  const stop = listenSessionChange(listener);
  broadcastSessionChange();
  expect(listener).not.toHaveBeenCalled();
  const other = new FakeChannel();
  other.postMessage({ type: "changed", source: "another-page" });
  other.postMessage("changed");
  window.dispatchEvent(
    new StorageEvent("storage", { key: "radishink-session-change" }),
  );
  expect(listener).toHaveBeenCalledTimes(3);
  stop();
  other.postMessage("changed");
  expect(listener).toHaveBeenCalledTimes(3);
  other.close();
});
