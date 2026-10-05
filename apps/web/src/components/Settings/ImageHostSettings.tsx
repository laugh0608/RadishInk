import { useState } from "react";
import type { ImageHostConfig } from "../../services/image/ImageUploader";
import {
  readImageHostConfigs,
  saveImageHostConfigs,
  type AllImageHostConfigs,
} from "../../services/image/imageHostConfig";
import {
  AliyunPanel,
  HostTabs,
  NoUploadPanel,
  OfficialHostPanel,
  QiniuPanel,
  S3Panel,
  TencentPanel,
  type HostTestResult,
} from "./ImageHostSettingsPanels";
import "./ImageHostSettings.css";

export function ImageHostSettings() {
  const [initial] = useState(() => {
    try {
      return { settings: readImageHostConfigs(), error: "" };
    } catch (error) {
      return {
        settings: { currentType: "none" as const, configs: {} },
        error: error instanceof Error ? error.message : "无法读取图床配置",
      };
    }
  });
  const [allConfigs, setAllConfigs] = useState<AllImageHostConfigs>(
    initial.settings,
  );
  const [viewingType, setViewingType] = useState<ImageHostConfig["type"]>(
    allConfigs.currentType,
  );
  const [testResult, setTestResult] = useState<HostTestResult | null>(null);

  const [activating, setActivating] = useState(false);

  const activeType = allConfigs.currentType;
  const viewingConfig: ImageHostConfig = {
    type: viewingType,
    config: allConfigs.configs[viewingType],
  };

  const persist = (settings: AllImageHostConfigs) => {
    try {
      saveImageHostConfigs(settings);
      setAllConfigs(settings);
      setTestResult(null);
    } catch {
      setTestResult({
        status: "error",
        message: "图床配置保存失败，请检查浏览器存储权限或空间。",
      });
    }
  };

  const handleTabChange = (type: ImageHostConfig["type"]) => {
    setViewingType(type);
    setTestResult(null);
  };

  const handleConfigChange = (key: string, value: string) => {
    persist({
      ...allConfigs,
      configs: {
        ...allConfigs.configs,
        [viewingType]: {
          ...allConfigs.configs[viewingType],
          [key]: value,
        },
      },
    });
  };

  const testConnection = async () => {
    setTestResult({ status: "loading", message: "正在测试连接" });
    try {
      const { ImageHostManager } = await import(
        "../../services/image/ImageUploader"
      );
      const manager = new ImageHostManager(viewingConfig);
      const valid = await manager.validate();
      setTestResult(
        valid
          ? { status: "success", message: "配置有效" }
          : { status: "error", message: "配置无效" },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({ status: "error", message });
    }
  };

  const handleActivate = async (type: ImageHostConfig["type"]) => {
    if (activating) return;
    if (type === "none") {
      persist({ ...allConfigs, currentType: type });
      return;
    }

    setActivating(true);
    setTestResult({
      status: "loading",
      message: type === "official" ? "正在检查地址" : "正在验证图床连接",
    });

    try {
      const { ImageHostManager } = await import(
        "../../services/image/ImageUploader"
      );
      const configToTest: ImageHostConfig = {
        type,
        config: allConfigs.configs[type],
      };
      const manager = new ImageHostManager(configToTest);
      const valid = await manager.validate();
      if (valid) {
        persist({ ...allConfigs, currentType: type });
      } else {
        setTestResult({
          status: "error",
          message: "无法启用：图床连接测试失败，请检查配置",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({
        status: "error",
        message: `无法启用：验证过程出错（${message}）`,
      });
    } finally {
      setActivating(false);
    }
  };

  if (initial.error) return <p role="alert">{initial.error}</p>;

  return (
    <fieldset
      className="image-host-settings"
      aria-label="图床配置"
      disabled={activating || testResult?.status === "loading"}
    >
      <HostTabs
        activeType={activeType}
        viewingType={viewingType}
        onTabChange={handleTabChange}
      />

      <p className="image-host-privacy-note">
        RadishInk
        不提供托管图床。启用后，粘贴、拖入或选择图片会上传至你配置的服务；凭据仅保存在当前浏览器。
        对象存储的“测试连接”和“启用”会向对应服务发送请求，部分服务会写入并删除测试文件。
      </p>

      <div className="host-config-panel">
        {viewingConfig.type === "none" && testResult?.status === "error" && (
          <p role="alert">{testResult.message}</p>
        )}
        {viewingConfig.type === "none" && (
          <NoUploadPanel
            activeType={activeType}
            onActivate={() => handleActivate("none")}
          />
        )}
        {viewingConfig.type === "official" && (
          <OfficialHostPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onActivate={() => handleActivate("official")}
          />
        )}

        {viewingConfig.type === "qiniu" && (
          <QiniuPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}

        {viewingConfig.type === "aliyun" && (
          <AliyunPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}

        {viewingConfig.type === "tencent" && (
          <TencentPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}

        {viewingConfig.type === "s3" && (
          <S3Panel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}
      </div>
    </fieldset>
  );
}
