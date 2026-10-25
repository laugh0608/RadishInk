// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";

const source = readFileSync(
  new URL("../../../public/pwa-update-guard.js", import.meta.url),
  "utf8",
);
function harness(clients: { id: string; url: string }[]) {
  let listener!: (event: unknown) => void;
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue(clients);
  runInNewContext(source, {
    self: {
      addEventListener: (_: string, fn: typeof listener) => {
        listener = fn;
      },
      skipWaiting,
      clients: { matchAll },
      registration: { scope: "https://test/app/" },
    },
  });
  return {
    skipWaiting,
    matchAll,
    async send(type: string, id = "one") {
      const port = { postMessage: vi.fn() };
      let task: Promise<void> | undefined;
      const stopImmediatePropagation = vi.fn();
      listener({
        data: { type },
        source: { id },
        ports: [port],
        stopImmediatePropagation,
        waitUntil: (p: Promise<void>) => {
          task = p;
        },
      });
      await task;
      return {
        response: port.postMessage.mock.calls[0]?.[0],
        stopImmediatePropagation,
      };
    },
  };
}
const one = { id: "one", url: "https://test/app/" };
describe("worker activation guard", () => {
  it("checks single-client readiness without activation", async () => {
    const h = harness([one]);
    expect((await h.send("RADISHINK_CHECK_UPDATE")).response).toEqual({
      ok: true,
    });
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });
  it("activates only for the sole in-scope requesting window", async () => {
    const h = harness([one, { id: "elsewhere", url: "https://test/another/" }]);
    expect((await h.send("RADISHINK_ACTIVATE_UPDATE")).response.ok).toBe(true);
    expect(h.skipWaiting).toHaveBeenCalledOnce();
    expect(h.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
  });
  it.each([
    { clients: [] },
    { clients: [one, { id: "old-version", url: "https://test/app/old" }] },
  ])("refuses missing or extra clients", async ({ clients }) => {
    const h = harness(clients);
    expect((await h.send("RADISHINK_ACTIVATE_UPDATE")).response.ok).toBe(false);
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });
  it("rechecks clients at activation, including a new tab opened after prepare", async () => {
    const h = harness([one]);
    await h.send("RADISHINK_CHECK_UPDATE");
    h.matchAll.mockResolvedValue([
      one,
      { id: "new", url: "https://test/app/" },
    ]);
    expect((await h.send("RADISHINK_ACTIVATE_UPDATE")).response.ok).toBe(false);
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });
  it("refuses a foreign sender and client enumeration failures", async () => {
    const h = harness([one]);
    expect(
      (await h.send("RADISHINK_ACTIVATE_UPDATE", "unknown")).response.ok,
    ).toBe(false);
    h.matchAll.mockRejectedValue(new Error("unavailable"));
    expect((await h.send("RADISHINK_ACTIVATE_UPDATE")).response.ok).toBe(false);
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });
  it("stops the generated unguarded legacy SKIP_WAITING listener", async () => {
    const h = harness([one]);
    const result = await h.send("SKIP_WAITING");
    expect(result.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(result.response).toBeUndefined();
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });
});
