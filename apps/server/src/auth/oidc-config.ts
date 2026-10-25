import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
} from 'node:fs';
import { ApiError } from '../http/api-error';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  clientAuth: 'client_secret_basic' | 'client_secret_post';
  admission: 'approval' | 'auto';
}
export function configuredFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (!['true', 'false'].includes(value))
    throw new ApiError(503, 'invalid-login-switch');
  return value === 'true';
}
export function canonicalBasePath(value = '/'): string {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value) || value.length > 200)
    throw new ApiError(503, 'invalid-base-path');
  return value;
}
export function oidcUrl(value: string, local: boolean): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(local && url.protocol === 'http:' && url.hostname === '127.0.0.1'))
  )
    throw new ApiError(503, 'invalid-oidc-url');
  return url;
}
function readSecret(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0)
      throw new ApiError(503, 'invalid-secret-file');
    const value = readFileSync(fd, 'utf8').replace(/\r?\n$/, '');
    if (
      !value ||
      Array.from(value).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new ApiError(503, 'invalid-secret-file');
    return value;
  } finally {
    closeSync(fd);
  }
}
export function oidcConfig(
  env: NodeJS.ProcessEnv,
  secure: boolean,
): OidcConfig | undefined {
  const enabled = configuredFlag(env.RADISHINK_OIDC_ENABLED, false);
  const keys = [
    'RADISHINK_OIDC_ISSUER',
    'RADISHINK_OIDC_CLIENT_ID',
    'RADISHINK_OIDC_CLIENT_SECRET_FILE',
    'RADISHINK_OIDC_CLIENT_AUTH',
    'RADISHINK_OIDC_ADMISSION',
  ];
  if (!enabled) {
    if (keys.some((key) => env[key] !== undefined))
      throw new ApiError(503, 'oidc-disabled-with-config');
    return undefined;
  }
  const issuer = env.RADISHINK_OIDC_ISSUER,
    clientId = env.RADISHINK_OIDC_CLIENT_ID,
    file = env.RADISHINK_OIDC_CLIENT_SECRET_FILE;
  if (
    !issuer ||
    !clientId ||
    clientId.length > 256 ||
    Array.from(clientId).some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    ) ||
    !file
  )
    throw new ApiError(503, 'oidc-configuration-required');
  const url = oidcUrl(issuer, !secure && env.NODE_ENV !== 'production');
  if (url.search || url.pathname.includes('/.well-known/'))
    throw new ApiError(503, 'invalid-issuer');
  const clientAuth = env.RADISHINK_OIDC_CLIENT_AUTH ?? 'client_secret_basic';
  const admission = env.RADISHINK_OIDC_ADMISSION ?? 'approval';
  if (
    !['client_secret_basic', 'client_secret_post'].includes(clientAuth) ||
    !['approval', 'auto'].includes(admission)
  )
    throw new ApiError(503, 'invalid-oidc-policy');
  return {
    issuer,
    clientId,
    clientSecret: readSecret(file),
    clientAuth: clientAuth as OidcConfig['clientAuth'],
    admission: admission as OidcConfig['admission'],
  };
}
