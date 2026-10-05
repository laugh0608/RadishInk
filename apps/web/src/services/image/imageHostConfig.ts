import type { ImageHostConfig } from "./ImageUploader";

export const IMAGE_UPLOAD_DISABLED_MESSAGE =
  "图片上传未启用，请先在图床设置中配置并启用自己的图床；也可以直接插入已有图片链接。";

export interface AllImageHostConfigs {
  currentType: ImageHostConfig["type"];
  configs: Partial<Record<ImageHostConfig["type"], Record<string, unknown>>>;
}

const HOST_TYPES = ["none", "official", "qiniu", "aliyun", "tencent", "s3"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeImageHostConfig(raw: unknown): ImageHostConfig {
  if (!isRecord(raw) || !HOST_TYPES.includes(String(raw.type))) {
    throw new Error("图床配置类型无效，请在图床设置中重新选择；原配置未删除。");
  }
  if (raw.config !== undefined && !isRecord(raw.config)) {
    throw new Error("图床配置内容无效，请检查设置；原配置未删除。");
  }
  // 旧版 official 未填写地址时代表上游默认服务。只停用隐式默认，不改写存储。
  if (
    raw.type === "official" &&
    (typeof raw.config?.serverUrl !== "string" || !raw.config.serverUrl.trim())
  ) {
    return { type: "none" };
  }
  return { type: raw.type as ImageHostConfig["type"], config: raw.config };
}

function readJson(key: string): unknown {
  const value = localStorage.getItem(key);
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("图床配置无法读取，请检查设置；原配置未删除。");
  }
}

export function getStoredImageHostConfig(): ImageHostConfig {
  const raw = readJson("imageHostConfig");
  if (raw !== undefined) return normalizeImageHostConfig(raw);
  const all = readImageHostConfigs();
  return { type: all.currentType, config: all.configs[all.currentType] };
}

export function readImageHostConfigs(): AllImageHostConfigs {
  const bank = readJson("imageHostConfigs");
  if (bank !== undefined && (!isRecord(bank) || !isRecord(bank.configs))) {
    throw new Error("图床配置列表无效，请检查设置；原配置未删除。");
  }
  const configs = isRecord(bank)
    ? { ...(bank.configs as AllImageHostConfigs["configs"]) }
    : {};
  const selected = readJson("imageHostConfig");
  const config =
    selected !== undefined
      ? normalizeImageHostConfig(selected)
      : isRecord(bank)
        ? normalizeImageHostConfig({
            type: bank.currentType,
            config: configs[bank.currentType as ImageHostConfig["type"]],
          })
        : { type: "none" as const };
  // 兼容只有单份配置的旧存储，保留多图床配置与显式自定义地址。
  if (config.config) configs[config.type] = config.config;
  return { currentType: config.type, configs };
}

export function saveImageHostConfigs(settings: AllImageHostConfigs): void {
  const keys = ["imageHostConfigs", "imageHostConfig"];
  const previous = keys.map((key) => localStorage.getItem(key));
  try {
    localStorage.setItem(keys[0], JSON.stringify(settings));
    localStorage.setItem(
      keys[1],
      JSON.stringify({
        type: settings.currentType,
        config: settings.configs[settings.currentType],
      }),
    );
  } catch (error) {
    // 两个既有键保持一致；写入失败时恢复此前值并让调用方显示错误。
    keys.forEach((key, index) => {
      if (previous[index] === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous[index]!);
    });
    throw error;
  }
}
