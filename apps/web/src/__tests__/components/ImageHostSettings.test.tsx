import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageHostSettings } from "../../components/Settings/ImageHostSettings";
import { ImageHostManager } from "../../services/image/ImageUploader";

describe("图床设置的数据去向与存储保护", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("初次打开保持上传关闭，不写入存储或请求网络", () => {
    render(<ImageHostSettings />);
    expect(screen.getByText("当前不上传图片")).toBeVisible();
    expect(screen.getByText(/RadishInk 不提供托管图床/)).toBeVisible();
    expect(screen.queryByText("官方图床")).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("打开旧默认配置不会覆盖它，也不会显示默认托管承诺", () => {
    const saved = '{"type":"official"}';
    localStorage.setItem("imageHostConfig", saved);
    render(<ImageHostSettings />);
    expect(screen.getByText("当前不上传图片")).toBeVisible();
    expect(localStorage.getItem("imageHostConfig")).toBe(saved);
    expect(localStorage.getItem("imageHostConfigs")).toBeNull();
  });

  it("关闭上传保留原来填写的图床凭据", () => {
    const config = {
      type: "s3",
      config: { bucket: "test-bucket", secretAccessKey: "synthetic-key" },
    };
    localStorage.setItem("imageHostConfig", JSON.stringify(config));
    render(<ImageHostSettings />);
    fireEvent.click(screen.getByRole("button", { name: "不上传" }));
    fireEvent.click(
      screen.getByRole("button", { name: "关闭图片上传，保留配置" }),
    );
    expect(JSON.parse(localStorage.getItem("imageHostConfig")!).type).toBe(
      "none",
    );
    expect(
      JSON.parse(localStorage.getItem("imageHostConfigs")!).configs.s3,
    ).toEqual(config.config);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("自定义接口需要填写地址再显式启用，启用不发起网络请求", async () => {
    render(<ImageHostSettings />);
    fireEvent.click(screen.getByRole("button", { name: "自定义接口" }));
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://images.example.com" },
    });
    expect(JSON.parse(localStorage.getItem("imageHostConfig")!).type).toBe(
      "none",
    );
    fireEvent.click(screen.getByRole("button", { name: "启用自定义接口" }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("imageHostConfig")!).type).toBe(
        "official",
      ),
    );
    expect(screen.getByText("当前使用中")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("损坏的配置显示可见错误，并保留原数据", () => {
    localStorage.setItem("imageHostConfigs", "{broken");
    render(<ImageHostSettings />);
    expect(screen.getByRole("alert")).toHaveTextContent("原配置未删除");
    expect(localStorage.getItem("imageHostConfigs")).toBe("{broken");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("验证进行中锁定配置编辑，避免旧结果覆盖新输入", async () => {
    let finish!: (value: boolean) => void;
    vi.spyOn(ImageHostManager.prototype, "validate").mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<ImageHostSettings />);
    fireEvent.click(screen.getByRole("button", { name: "自定义接口" }));
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "https://images.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "启用自定义接口" }));
    await waitFor(() =>
      expect(ImageHostManager.prototype.validate).toHaveBeenCalled(),
    );
    expect(screen.getByLabelText("服务地址")).toBeDisabled();
    expect(screen.getByRole("button", { name: "S3 兼容" })).toBeDisabled();
    finish(true);
    await waitFor(() =>
      expect(screen.getByLabelText("服务地址")).toBeEnabled(),
    );
    expect(
      JSON.parse(localStorage.getItem("imageHostConfig")!).config.serverUrl,
    ).toBe("https://images.example.com");
  });
});
