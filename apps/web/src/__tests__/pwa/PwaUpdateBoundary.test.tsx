import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaUpdateBoundary } from "../../pwa/PwaUpdateBoundary";
import { SAFE_RELOAD_EVENT } from "../../pwa/safeReloadRequest";
import type { UpdateNotice } from "../../pwa/updateClient";

const mocks = vi.hoisted(() => ({
  notify: null as null | ((notice: UpdateNotice) => void),
  prepare: vi.fn(),
  activate: vi.fn(),
  check: vi.fn(),
  dispose: vi.fn(),
  save: vi.fn(),
  idle: vi.fn(),
  guard: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("../../storage/StorageContext", () => ({
  useStorageContext: () => ({ ready: true }),
}));
vi.mock("../../hooks/useFileSystem", () => ({
  useFileSystem: () => ({ persistActiveFile: mocks.persist }),
}));
vi.mock("../../pwa/saveBeforeUpdate", () => ({
  assertUpdateIdle: mocks.idle,
  saveBeforeUpdate: mocks.save,
}));
vi.mock("../../pwa/updateClient", async (original) => ({
  ...(await original<object>()),
  watchPwaUpdates: (_: unknown, _base: URL, notify: typeof mocks.notify) => {
    mocks.notify = notify;
    return {
      prepare: mocks.prepare,
      activate: mocks.activate,
      check: mocks.check,
      dispose: mocks.dispose,
    };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PROD", true);
  vi.stubGlobal("navigator", { serviceWorker: {} });
  mocks.idle.mockImplementation(() => {});
  mocks.save.mockResolvedValue(mocks.guard);
  mocks.prepare.mockResolvedValue({ state: "installed" });
  mocks.activate.mockRejectedValue(new Error("synthetic activation failure"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function setup() {
  const result = render(
    <PwaUpdateBoundary>
      <textarea aria-label="合成草稿" defaultValue="未保存正文" />
    </PwaUpdateBoundary>,
  );
  act(() => mocks.notify?.({ available: true, error: "" }));
  return result;
}
describe("update consent and UI safety", () => {
  it("never saves or activates on discovery or postponement", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "有新版本，查看更新" }));
    expect(screen.getByRole("button", { name: "保存并更新" })).toBeVisible();
  });
  it("blocks busy transfers before asking the worker or saving", async () => {
    setup();
    mocks.idle.mockImplementation(() => {
      throw new Error("图片正在写入");
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并更新" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("图片正在写入");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects other-tab refusal without touching persistence", async () => {
    setup();
    mocks.prepare.mockRejectedValue(new Error("其他页面未关闭"));
    fireEvent.click(screen.getByRole("button", { name: "保存并更新" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "其他页面未关闭",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("makes the app inert during persistence and restores input after failure", async () => {
    let reject!: (error: Error) => void;
    mocks.save.mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "保存并更新" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(
      (container.querySelector(".pwa-app-content") as HTMLElement).inert,
    ).toBe(true);
    expect(screen.getByRole("dialog")).toHaveTextContent("正在安全更新");
    await act(async () => reject(new Error("保存拒绝")));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存拒绝");
    expect(
      (container.querySelector(".pwa-app-content") as HTMLElement).inert,
    ).toBe(false);
    expect(screen.getByLabelText("合成草稿")).toHaveValue("未保存正文");
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("checks the saved snapshot before activation and exposes activation failure for retry", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "保存并更新" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "synthetic activation failure",
    );
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activate.mock.invocationCallOrder[0],
    );
    expect(screen.getByRole("button", { name: "保存并更新" })).toBeEnabled();
  });
  it("turns a chunk failure into an explicit safe reload request", () => {
    setup();
    act(() => window.dispatchEvent(new Event(SAFE_RELOAD_EVENT)));
    expect(screen.getByText("页面资源需要重新加载")).toBeVisible();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("ignores late save completion after timeout", async () => {
    vi.useFakeTimers();
    let resolve!: (guard: () => void) => void;
    mocks.save.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "保存并更新" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("保存等待超时");
    await act(async () => resolve(mocks.guard));
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});
