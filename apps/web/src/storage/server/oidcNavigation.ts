import { getRuntimeConfig } from "./runtimeConfig";
import { useServerState, type ServerClient } from "./serverClient";
import { broadcastSessionChange } from "./privateWorkspace";

const notices: Record<string, string> = {
  "signed-in": "已通过 Radish 登录。",
  linked: "Radish 身份已绑定到当前账号。",
  pending:
    "Radish 身份已验证，等待部署管理员批准后才能使用服务器文章。请批准后重新登录。",
  cancelled: "已取消 Radish 授权，原稿仍保留在原存储中。",
  failed:
    "本次 Radish 授权未完成。请重试，或联系部署管理员核对配置与账号状态。",
};
/** 回调只传固定结果码；在 React 启动前移除结果参数并通知其他本站标签。 */
export function consumeOidcResult() {
  if (getRuntimeConfig().deployment !== "server") return;
  const url = new URL(window.location.href),
    result = url.searchParams.get("radishink-auth");
  if (!result) return;
  url.searchParams.delete("radishink-auth");
  window.history.replaceState(window.history.state, "", url);
  useServerState.setState({ oidcNotice: notices[result] ?? notices.failed });
  if (result === "signed-in" || result === "linked") broadcastSessionChange();
}

export async function navigateToOidc(
  client: ServerClient,
  purpose: "login" | "link",
  save: () => Promise<() => void>,
  navigate = (url: string) => window.location.assign(url),
) {
  const assertSaved = await save();
  const url = await client.startOidc(purpose);
  assertSaved();
  navigate(url);
}
