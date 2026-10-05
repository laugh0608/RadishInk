import type { ImageUploader } from "../ImageUploader";

interface OfficialConfig {
  serverUrl?: string;
}

/**
 * 兼容上游上传协议的自定义接口；保留类名和存储 type 以读取既有配置。
 */
export class OfficialUploader implements ImageUploader {
  name = "自定义上传接口";
  private serverUrl: string;

  constructor(config?: OfficialConfig) {
    this.serverUrl = config?.serverUrl?.trim().replace(/\/+$/, "") || "";
  }

  configure(config: OfficialConfig) {
    this.serverUrl = config.serverUrl?.trim().replace(/\/+$/, "") || "";
  }

  private uploadUrl(): string {
    if (!this.serverUrl) throw new Error("请先填写自定义上传接口地址。");
    let url: URL;
    try {
      url = new URL(this.serverUrl);
    } catch {
      throw new Error("上传接口地址须为完整的 HTTP 或 HTTPS 地址。");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "上传接口须使用 HTTP 或 HTTPS，且不能包含用户名、密码、查询参数或锚点。",
      );
    }
    return `${url.href.replace(/\/+$/, "")}/upload`;
  }

  async validate(): Promise<boolean> {
    this.uploadUrl();
    // 协议没有只读健康检查；只验证地址，不声称远程连接已经成功。
    return true;
  }

  async upload(file: File): Promise<string> {
    const url = this.uploadUrl();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    let data: { error?: unknown; url?: unknown } | null;
    try {
      data = await response.json();
    } catch {
      throw new Error(`上传接口返回的不是 JSON（HTTP ${response.status}）。`);
    }

    if (!response.ok) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : `上传失败（HTTP ${response.status}）。`,
      );
    }

    if (typeof data?.url !== "string") {
      throw new Error("上传接口未返回有效的图片地址。");
    }

    try {
      const imageUrl = new URL(data.url);
      if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error();
    } catch {
      throw new Error("上传接口返回的图片地址须为完整的 HTTP 或 HTTPS 地址。");
    }

    return data.url;
  }
}
