import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askUpdateWorker,
  watchPwaUpdates,
  withUpdateTimeout,
  type UpdateNotice,
} from "../../pwa/updateClient";

class Worker extends EventTarget {
  state = "installed";
  reply = { ok: true, error: "" };
  postMessage = vi.fn(
    (
      _data: unknown,
      ports: Array<{ postMessage: (reply: unknown) => void }>,
    ) => {
      ports[0].postMessage(this.reply);
    },
  );
  change(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
class Registration extends EventTarget {
  waiting: Worker | null = new Worker();
  active: Worker | null = new Worker();
  installing: Worker | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}
class Container extends EventTarget {
  controller: Worker | null = new Worker();
  registration = new Registration();
  register = vi.fn().mockResolvedValue(this.registration);
}
let container: Container;
let notices: UpdateNotice[];
const clients: Array<ReturnType<typeof watchPwaUpdates>> = [];
const start = () => {
  const client = watchPwaUpdates(
    container as unknown as ServiceWorkerContainer,
    new URL("https://test/nested/"),
    (state) => notices.push(state),
  );
  clients.push(client);
  return client;
};
beforeEach(() => {
  container = new Container();
  notices = [];
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        onmessage: null as null | ((event: { data: unknown }) => void),
        close: vi.fn(),
      };
      port2 = {
        postMessage: (data: unknown) =>
          queueMicrotask(() => this.port1.onmessage?.({ data })),
        close: vi.fn(),
      };
    },
  );
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("update client lifecycle", () => {
  it("registers under the deployment base and detects an already waiting version", async () => {
    const client = start();
    await client.check(true);
    expect(container.register).toHaveBeenCalledWith(
      "https://test/nested/sw.js",
      { scope: "https://test/nested/", updateViaCache: "none" },
    );
    expect(notices.at(-1)).toEqual({ available: true, error: "" });
    expect(container.registration.waiting!.postMessage).not.toHaveBeenCalled();
  });
  it("first installation is not announced as an update", async () => {
    container.controller = null;
    container.registration.waiting = null;
    container.registration.active = null;
    const worker = new Worker();
    container.registration.installing = worker;
    const client = start();
    await client.check(true);
    container.registration.waiting = worker;
    worker.change("installed");
    expect(notices.every((n) => !n.available)).toBe(true);
  });
  it("discovers an update installed after registration", async () => {
    container.registration.waiting = null;
    const client = start();
    await client.check(true);
    const worker = new Worker();
    container.registration.installing = worker;
    container.registration.dispatchEvent(new Event("updatefound"));
    container.registration.waiting = worker;
    worker.change("installed");
    expect(notices.at(-1)?.available).toBe(true);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
  it("checks other tabs before activation, and surfaces their refusal", async () => {
    const worker = container.registration.waiting!;
    worker.reply = { ok: false, error: "请关闭其他页面" };
    const client = start();
    await expect(client.prepare()).rejects.toThrow("其他页面");
    expect(worker.postMessage.mock.calls[0][0]).toEqual({
      type: "RADISHINK_CHECK_UPDATE",
    });
  });
  it("does not finish activation until this page is actually controlled by the new worker", async () => {
    const client = start();
    const worker = await client.prepare();
    let finished = false;
    const task = client.activate(worker).then(() => {
      finished = true;
    });
    await vi.waitFor(() =>
      expect(container.registration.waiting!.postMessage).toHaveBeenCalledTimes(
        2,
      ),
    );
    container.registration.waiting!.change("activated");
    await Promise.resolve();
    expect(finished).toBe(false);
    container.controller = container.registration.waiting;
    container.dispatchEvent(new Event("controllerchange"));
    await task;
    expect(finished).toBe(true);
  });
  it("notifies about external takeover without sending activation messages", async () => {
    container.registration.waiting = null;
    const client = start();
    await client.check(true);
    container.controller = new Worker();
    container.dispatchEvent(new Event("controllerchange"));
    expect(notices.at(-1)?.available).toBe(true);
    expect(await client.prepare()).toBeNull();
    expect(container.controller.postMessage).not.toHaveBeenCalled();
  });
  it("refuses a different waiting version after saving", async () => {
    const client = start();
    const worker = await client.prepare();
    container.registration.waiting = new Worker();
    await expect(client.activate(worker)).rejects.toThrow("版本已变化");
  });
  it("recovers registration failure through explicit retry", async () => {
    container.register.mockRejectedValueOnce(new Error("offline"));
    const client = start();
    await client.check();
    expect(notices.at(-1)?.error).toContain("offline");
    await client.check(true);
    expect(container.register).toHaveBeenCalledTimes(2);
    expect(notices.at(-1)?.available).toBe(true);
  });
  it("surfaces network errors without discarding a waiting version", async () => {
    container.registration.update.mockRejectedValue(new Error("offline"));
    const client = start();
    await client.check(true);
    expect(notices.at(-1)).toEqual({
      available: true,
      error: expect.stringContaining("网络"),
    });
  });
  it("stops listeners and notifications after disposal", async () => {
    const client = start();
    await client.check(true);
    client.dispose();
    const count = notices.length;
    container.controller = new Worker();
    container.dispatchEvent(new Event("controllerchange"));
    expect(notices).toHaveLength(count);
  });
  it("times out unresponsive workers without treating silence as success", async () => {
    vi.useFakeTimers();
    const worker = new Worker();
    worker.postMessage.mockImplementation(() => {});
    const result = expect(
      askUpdateWorker(
        worker as unknown as ServiceWorker,
        "RADISHINK_CHECK_UPDATE",
      ),
    ).rejects.toThrow("未响应");
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
  });
  it("bounds persistence waits and ignores late completion", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const task = new Promise<void>((r) => {
      resolve = r;
    });
    const result = expect(
      withUpdateTimeout(task, "save timeout", 100),
    ).rejects.toThrow("save timeout");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    resolve();
    await Promise.resolve();
  });
});
