import { Blob as NodeBlob } from "node:buffer";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  ArticleWorkspaceContext,
  type ArticleWorkspace,
} from "../../components/ArticleAssets/ArticleWorkspaceContext";
import { useArticleImageUrls } from "../../components/ArticleAssets/useArticleImageUrls";

afterEach(() => vi.unstubAllGlobals());
it("文章切换和卸载释放 URL，迟到的资源读取不能创建 URL", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  const create = vi.fn(() => `blob:test-${Math.random()}`);
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, 1);
  new DataView(bytes.buffer).setUint32(20, 1);
  const asset = { path: "asset/test.png", bytes: new Blob([bytes]) };
  let workspace: ArticleWorkspace = {
    assets: [asset],
    identity: {},
    revision: 0,
    error: "",
    capture: () => {
      throw new Error("unused");
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ArticleWorkspaceContext.Provider value={workspace}>
      {children}
    </ArticleWorkspaceContext.Provider>
  );
  const hook = renderHook(useArticleImageUrls, { wrapper });
  await waitFor(() => expect(hook.result.current.size).toBe(1));
  const first = hook.result.current.get(asset.path);
  let finish!: (buffer: ArrayBuffer) => void;
  workspace = {
    ...workspace,
    identity: {},
    assets: [
      {
        ...asset,
        bytes: {
          size: 24,
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((resolve) => {
              finish = resolve;
            }),
        } as Blob,
      },
    ],
  };
  hook.rerender();
  expect(revoke).toHaveBeenCalledWith(first);
  workspace = { ...workspace, identity: {}, assets: [asset] };
  hook.rerender();
  finish(bytes.buffer);
  await waitFor(() => expect(hook.result.current.size).toBe(1));
  expect(create).toHaveBeenCalledTimes(2);
  const second = hook.result.current.get(asset.path);
  hook.unmount();
  expect(revoke).toHaveBeenCalledWith(second);
  expect(revoke).toHaveBeenCalledTimes(2);
});
