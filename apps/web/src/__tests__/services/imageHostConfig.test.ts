import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImageHostManager,
  type ImageHostConfig,
} from "../../services/image/ImageUploader";
import {
  getStoredImageHostConfig,
  readImageHostConfigs,
  saveImageHostConfigs,
} from "../../services/image/imageHostConfig";
import { uploadEditorImage } from "../../services/image/imageUploadFlow";
import { OfficialUploader } from "../../services/image/uploaders/OfficialUploader";

const image = () =>
  new File(["synthetic image"], "test.png", { type: "image/png" });

describe("图床默认行为与旧配置兼容", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("新用户默认不上传，失败发生在压缩或网络操作前", async () => {
    const createManager = vi.fn();
    expect(getStoredImageHostConfig()).toEqual({
      type: "none",
      config: undefined,
    });
    await expect(uploadEditorImage(image(), { createManager })).rejects.toThrow(
      "图片上传未启用",
    );
    expect(createManager).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    { type: "official" },
    { type: "official", config: {} },
    { type: "official", config: { serverUrl: " " } },
  ])("停用旧默认服务且不改写原存储：%j", async (config) => {
    const saved = JSON.stringify(config);
    localStorage.setItem("imageHostConfig", saved);
    expect(getStoredImageHostConfig().type).toBe("none");
    await expect(uploadEditorImage(image())).rejects.toThrow("图片上传未启用");
    expect(localStorage.getItem("imageHostConfig")).toBe(saved);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["qiniu", "aliyun", "tencent", "s3", "official"] as const)(
    "保留显式配置与旧键：%s",
    (type) => {
      const config = {
        type,
        config: {
          serverUrl: "https://images.example.com",
          secret: "synthetic-secret",
        },
      };
      localStorage.setItem("imageHostConfig", JSON.stringify(config));
      expect(getStoredImageHostConfig()).toEqual(config);
      expect(readImageHostConfigs()).toEqual({
        currentType: type,
        configs: { [type]: config.config },
      });
      expect(localStorage.getItem("imageHostConfigs")).toBeNull();
    },
  );

  it("读取只有配置列表的旧存储，并在关闭上传时保留其他图床设置和草稿", () => {
    const settings = {
      currentType: "s3" as const,
      configs: {
        s3: { bucket: "synthetic" },
        official: { serverUrl: "https://example.com" },
      },
    };
    localStorage.setItem("imageHostConfigs", JSON.stringify(settings));
    localStorage.setItem("wemd-draft", "synthetic draft");
    expect(getStoredImageHostConfig()).toEqual({
      type: "s3",
      config: settings.configs.s3,
    });
    saveImageHostConfigs({ ...readImageHostConfigs(), currentType: "none" });
    expect(getStoredImageHostConfig().type).toBe("none");
    expect(readImageHostConfigs().configs).toEqual(settings.configs);
    expect(localStorage.getItem("wemd-draft")).toBe("synthetic draft");
  });

  it.each([
    "{broken",
    "null",
    "[]",
    '{"type":"unknown"}',
    '{"type":"s3","config":"broken"}',
  ])("损坏配置明确报错，不使用默认服务或覆盖原文：%s", async (saved) => {
    localStorage.setItem("imageHostConfig", saved);
    await expect(uploadEditorImage(image())).rejects.toThrow("图床配置");
    expect(localStorage.getItem("imageHostConfig")).toBe(saved);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("绕过设置直接传入未知类型也不能回落到上游服务", async () => {
    const manager = new ImageHostManager({
      type: "unknown",
    } as unknown as ImageHostConfig);
    await expect(manager.upload(image())).rejects.toThrow("图片上传未启用");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("第二个存储键写入失败时恢复原设置，并报告失败", () => {
    const original = {
      currentType: "s3" as const,
      configs: { s3: { bucket: "synthetic" } },
    };
    saveImageHostConfigs(original);
    const before = { ...localStorage };
    const setItem = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === "imageHostConfig" && !failed) {
        failed = true;
        throw new Error("quota");
      }
      setItem.call(this, key, value);
    });
    expect(() =>
      saveImageHostConfigs({ ...original, currentType: "none" }),
    ).toThrow("quota");
    expect({ ...localStorage }).toEqual(before);
  });
});

describe("自定义上传接口", () => {
  it.each([null, {}, { url: 123 }, { url: "javascript:alert(1)" }])(
    "拒绝无效的上传成功响应：%j",
    async (data) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(data), { status: 200 }),
      );
      await expect(
        new OfficialUploader({
          serverUrl: "https://images.example.com",
        }).upload(image()),
      ).rejects.toThrow("图片地址");
    },
  );

  it("非 JSON 错误返回携带 HTTP 状态，不能伪造上传成功", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Bad gateway", { status: 502 }),
    );
    await expect(
      new OfficialUploader({ serverUrl: "https://images.example.com" }).upload(
        image(),
      ),
    ).rejects.toThrow("HTTP 502");
  });
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    undefined,
    "",
    "images.example.com",
    "javascript:alert(1)",
    "https://user:password@example.com",
    "https://example.com?token=secret",
  ])("缺失或无效地址不能发起请求：%s", async (serverUrl) => {
    const uploader = new OfficialUploader({ serverUrl });
    await expect(uploader.upload(image())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("只在实际上传时访问用户填写的地址，验证不伪造远程连接", async () => {
    const uploader = new OfficialUploader({
      serverUrl: "https://images.example.com/base/",
    });
    expect(await uploader.validate()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ url: "https://cdn.example.com/test.png" }),
        { status: 200 },
      ),
    );
    expect(await uploader.upload(image())).toBe(
      "https://cdn.example.com/test.png",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://images.example.com/base/upload",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });
});
