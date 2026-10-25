export type RuntimeConfig =
  | { deployment: "static" }
  | { deployment: "server"; apiBase: string };

let config: RuntimeConfig = { deployment: "static" };
export function getRuntimeConfig(): RuntimeConfig {
  return config;
}

export function parseRuntimeConfig(
  value: unknown,
  baseUrl: string,
): RuntimeConfig {
  if (!value || typeof value !== "object")
    throw new Error("运行时配置不是对象");
  const row = value as Record<string, unknown>;
  if (row.deployment === "static" && Object.keys(row).length === 1)
    return { deployment: "static" };
  const base = new URL(".", baseUrl);
  if (
    row.deployment !== "server" ||
    typeof row.apiBase !== "string" ||
    Object.keys(row).some((k) => !["deployment", "apiBase"].includes(k)) ||
    row.apiBase !== `${base.pathname}api/v1`
  )
    throw new Error("服务器配置无效：API 必须为部署目录内同源的 api/v1");
  return { deployment: "server", apiBase: row.apiBase };
}

export function initializeRuntimeConfig(document: Document) {
  const source = document.getElementById(
    "radishink-runtime-config",
  )?.textContent;
  if (!source) throw new Error("缺少运行时配置，请检查部署文件");
  config = parseRuntimeConfig(JSON.parse(source), document.baseURI);
}
