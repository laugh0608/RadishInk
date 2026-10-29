import { ApiError } from './api-error';
import {
  canonicalBasePath,
  configuredFlag,
  oidcConfig,
  type OidcConfig,
} from '../auth/oidc-config';
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
  accountMode?: 'accounts' | 'shared';
  directory: string;
  origin: string;
  port: number;
  secure: boolean;
  host?: '127.0.0.1' | '0.0.0.0';
  basePath?: string;
  passwordLogin?: boolean;
  oidc?: OidcConfig;
}
export function serverConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const origin = env.RADISHINK_ORIGIN;
  const directory = env.RADISHINK_DATA_DIR;
  const port = Number(env.PORT ?? 4000);
  const host = env.RADISHINK_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0')
    throw new ApiError(503, 'invalid-listen-host');
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
    (env.NODE_ENV === 'production' || url.hostname !== '127.0.0.1')
  )
    throw new ApiError(503, 'https-required');
  // 公开 Origin 与内部监听独立；代理头仍不作为身份或 HTTPS 的依据。
  const accountMode = env.RADISHINK_ACCOUNT_MODE ?? 'accounts';
  if (!['accounts', 'shared'].includes(accountMode))
    throw new ApiError(503, 'invalid-account-mode');
  const passwordLogin = configuredFlag(
    env.RADISHINK_PASSWORD_LOGIN,
    accountMode === 'accounts',
  );
  const oidc = oidcConfig(env, secure);
  if (accountMode === 'shared' && (passwordLogin || oidc))
    throw new ApiError(503, 'shared-login-forbidden');
  if (accountMode === 'accounts' && !passwordLogin && !oidc)
    throw new ApiError(503, 'login-method-required');
  return {
    accountMode: accountMode as 'accounts' | 'shared',
    directory,
    origin,
    port,
    secure,
    host,
    basePath: canonicalBasePath(env.RADISHINK_BASE_PATH),
    passwordLogin,
    oidc,
  };
}
