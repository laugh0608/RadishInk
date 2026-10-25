import { ApiError } from './api-error';
import { DEFAULT_STORAGE_LIMITS } from '../storage/storage-contract';

export const HTTP_POLICY = Object.freeze({
  bodyBytes: 66 * 1024 * 1024,
  manifestBytes: 1024 * 1024 + 64 * 1024,
  jsonBytes: 4096,
  imagePixels: 16_000_000,
  requestMs: 60_000,
  writes: 4,
  storageJobs: 8,
  connections: 64,
});
export const PUBLIC_LIMITS = Object.freeze({
  ...DEFAULT_STORAGE_LIMITS,
  ...HTTP_POLICY,
});
export interface ServerConfig {
  directory: string;
  origin: string;
  port: number;
  secure: boolean;
}
export function serverConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const origin = env.RADISHINK_ORIGIN;
  const directory = env.RADISHINK_DATA_DIR;
  const port = Number(env.PORT ?? 4000);
  if (
    !origin ||
    !directory ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new ApiError(503, 'configuration-required');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ApiError(503, 'invalid-origin');
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new ApiError(503, 'invalid-origin');
  const secure = url.protocol === 'https:';
  if (
    !secure &&
    (env.NODE_ENV === 'production' ||
      url.hostname !== '127.0.0.1' ||
      Number(url.port || 80) !== port)
  )
    throw new ApiError(503, 'https-required');
  // 本切片入口固定 loopback；不读取信任代理或任意 bind 地址配置。
  return { directory, origin, port, secure };
}
