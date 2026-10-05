import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, ExternalLink, X } from "lucide-react";
import toast from "react-hot-toast";

import {
  getAiConfig,
  getProviderConfig,
  getProviderPreset,
  isAiConfigComplete,
  MAX_PREFERENCE_CHARS,
  setAiConfig,
  type AiConfig,
  type AiProviderId,
} from "../../services/ai/aiConfig";
import {
  AiRequestError,
  SLOW_FIRST_TOKEN_MS,
  testConnection,
} from "../../services/ai/aiClient";
import { PixelLoader, Switch } from "../common";
import { AiModelField } from "./AiModelField";
import { AiProviderSelect } from "./AiProviderSelect";
import "./AiSettings.css";

interface AiSettingsProps {
  onClose?: () => void;
}

export function AiSettings({ onClose }: AiSettingsProps) {
  const [draft, setDraft] = useState<AiConfig>(() => getAiConfig());
  const [saved, setSaved] = useState<AiConfig>(() => getAiConfig());
  const [showKey, setShowKey] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [test, setTest] = useState<
    | { state: "idle" }
    | { state: "testing" }
    | { state: "ok"; firstTokenMs: number }
    | { state: "fail"; message: string }
  >({ state: "idle" });
  const closeTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  const preset = getProviderPreset(draft.provider);
  const isCustom = draft.provider === "custom";
  // 开关作用于已保存的配置，未保存过就没有可启用的东西
  const canToggle = isAiConfigComplete(saved);

  const update = (patch: Partial<AiConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setTest({ state: "idle" });
  };

  const persist = (next: AiConfig) => {
    setAiConfig(next);
    setSaved(next);
    setDraft(next);
  };

  const handleToggle = (enabled: boolean) => {
    persist({ ...saved, enabled });
    toast.success(enabled ? "AI 优化已启用" : "AI 优化已关闭");
  };

  const handleProviderChange = (provider: AiProviderId) => {
    // 取回该服务商自己存过的 Key 与模型，没存过才回落到预设
    const restored = getProviderConfig(provider);
    setDraft((prev) => ({
      ...restored,
      enabled: prev.enabled,
      preference: prev.preference,
    }));
    setTest({ state: "idle" });
  };

  // 保存与测试成功共用：首次填全后直接可用，避免"填了 Key 但开关没开所以没反应"
  const commit = () => {
    const complete = isAiConfigComplete(draft);
    const enabled = complete && (canToggle ? draft.enabled : true);
    persist({ ...draft, enabled });
    return complete;
  };

  const handleTest = async () => {
    setTest({ state: "testing" });
    try {
      const probe = await testConnection({ config: draft });
      // 连通即证明配置可用，立刻落盘，否则切走再切回来就丢了
      commit();
      setTest({ state: "ok", firstTokenMs: probe.firstTokenMs });
    } catch (error) {
      setTest({
        state: "fail",
        message:
          error instanceof AiRequestError ? error.message : "连接失败，请重试",
      });
    }
  };

  const handleSave = () => {
    const complete = commit();
    toast.success(
      complete ? "AI 优化设置已保存" : "已保存，填写 API Key 后可启用",
    );
    // 先让按钮把"存好了"演完再关窗，直接关掉会让人怀疑有没有生效
    setSavedFeedback(true);
    closeTimerRef.current = window.setTimeout(() => {
      setSavedFeedback(false);
      onClose?.();
    }, 600);
  };

  return (
    <div className="ai-settings">
      <div className="ai-settings-toggle">
        <div className="ai-toggle-row">
          <span className="ai-toggle-title">启用 AI 优化</span>
          <Switch
            label="启用 AI 优化"
            checked={saved.enabled}
            disabled={!canToggle}
            onChange={handleToggle}
          />
        </div>
        <small>
          {!canToggle
            ? "填写 API Key 并保存后可启用"
            : saved.enabled
              ? "关闭后保留配置，编辑器中不再出现改写入口"
              : "已保存配置，开启后可在编辑器中使用"}
        </small>
      </div>

      <div className="config-field">
        <label id="ai-provider-label">服务商</label>
        <AiProviderSelect
          value={draft.provider}
          onChange={handleProviderChange}
          labelId="ai-provider-label"
        />
      </div>

      {isCustom && (
        <div className="config-field">
          <label htmlFor="ai-base-url">Base URL</label>
          <input
            id="ai-base-url"
            type="text"
            placeholder="https://your-endpoint/v1"
            value={draft.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
          />
          <small>需为 OpenAI 兼容接口，且允许浏览器跨域调用</small>
        </div>
      )}

      <div className="config-field">
        <label htmlFor="ai-api-key">API Key</label>
        <div className="ai-key-input">
          <input
            id="ai-api-key"
            type={showKey ? "text" : "password"}
            placeholder="粘贴服务商提供的 API Key"
            value={draft.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
          <button
            type="button"
            className="ai-key-reveal"
            aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
            onClick={() => setShowKey((prev) => !prev)}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {preset.apiKeyUrl && (
          <small>
            <a href={preset.apiKeyUrl} target="_blank" rel="noreferrer">
              获取 {preset.label} API Key
              <ExternalLink size={11} />
            </a>
          </small>
        )}
      </div>

      <div className="config-field">
        <label htmlFor="ai-model">模型</label>
        <AiModelField
          config={draft}
          placeholder={preset.defaultModel || "模型名称"}
          onChange={(model) => update({ model })}
        />
        <small>可展开选择服务商支持的模型，也可直接手动填写</small>
      </div>

      <div className="config-field">
        <label htmlFor="ai-preference">写作偏好</label>
        <textarea
          id="ai-preference"
          className="ai-preference-input"
          rows={3}
          maxLength={MAX_PREFERENCE_CHARS}
          placeholder="例：读者是产品经理；不要口语化；「用户」不要写成「客户」"
          value={draft.preference}
          onChange={(event) => update({ preference: event.target.value })}
        />
        <small>
          写作偏好会用于改写、全文审阅和起标题；留空则不发送。
          <span className="ai-preference-count">
            {draft.preference.length}/{MAX_PREFERENCE_CHARS}
          </span>
        </small>
      </div>

      <p className="ai-privacy-note">
        AI
        默认关闭。启用并执行写作操作，或测试连接、打开及刷新模型列表时，会直接连接所选服务商；API
        Key 仅保存在当前浏览器。 当前请求地址：{draft.baseUrl}。
        {
          "改写只发送选中片段及其前后各一段；全文审阅与起标题最多发送正文前 12,000 字，超出时会明确提示；写作偏好随每次请求一并发送。"
        }
      </p>

      {test.state !== "idle" && (
        <div
          className={`ai-test-result is-${
            test.state === "ok" && test.firstTokenMs > SLOW_FIRST_TOKEN_MS
              ? "slow"
              : test.state
          }`}
          role="status"
        >
          {test.state === "testing" && (
            <PixelLoader label={`正在连接 ${draft.model}`} />
          )}
          {test.state === "ok" &&
            (test.firstTokenMs > SLOW_FIRST_TOKEN_MS ? (
              <>
                <X size={13} />
                已连接 {draft.model}，但首字用了{" "}
                {(test.firstTokenMs / 1000).toFixed(1)} 秒。配置已保存，
                实际使用会明显卡顿，建议换更快的模型或服务商
              </>
            ) : (
              <>
                <Check size={13} />
                已连接 {draft.model}（首字{" "}
                {(test.firstTokenMs / 1000).toFixed(1)} 秒），配置已保存
              </>
            ))}
          {test.state === "fail" && (
            <>
              <X size={13} />
              {test.message}
            </>
          )}
        </div>
      )}

      <div className="config-footer">
        <small>用法：在编辑器中选中文字，即可使用 AI 改写</small>
        <button
          type="button"
          className="btn-test-ai"
          disabled={!isAiConfigComplete(draft) || test.state === "testing"}
          onClick={handleTest}
        >
          测试连接
        </button>
        <button
          type="button"
          className={`btn-activate${savedFeedback ? " is-saved" : ""}`}
          disabled={savedFeedback}
          onClick={handleSave}
        >
          {savedFeedback ? (
            <>
              <Check size={14} />
              已保存
            </>
          ) : (
            "保存"
          )}
        </button>
      </div>
    </div>
  );
}
