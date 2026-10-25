import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';
import type { ServerConfig } from './server-policy';
import { sha256 } from '../storage/storage-contract';

export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class BrowserSecurity {
  readonly sessionName: string;
  readonly preauthName: string;
  private readonly key = randomBytes(32);
  constructor(private readonly config: ServerConfig) {
    this.sessionName = config.secure
      ? '__Host-radishink-session'
      : 'radishink-dev-session';
    this.preauthName = config.secure
      ? '__Host-radishink-preauth'
      : 'radishink-dev-preauth';
  }
  cookies(req: Request): Map<string, string> {
    const result = new Map<string, string>();
    for (const pair of (req.headers.cookie ?? '').split(';')) {
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (result.has(name)) throw new ApiError(403, 'duplicate-cookie');
      result.set(name, value);
    }
    return result;
  }
  checkOrigin(req: Request, write: boolean): void {
    // Host 校验同时限制本地 DNS rebinding；完全忽略 X-Forwarded-*。
    if (
      req.headers.host !== new URL(this.config.origin).host ||
      (req.headers.origin !== undefined &&
        req.headers.origin !== this.config.origin) ||
      (write && req.headers.origin !== this.config.origin) ||
      (req.headers['sec-fetch-site'] &&
        !['same-origin', 'none'].includes(
          String(req.headers['sec-fetch-site']),
        ))
    )
      throw new ApiError(403, 'origin');
  }
  csrf(token: string): string {
    return sha256('radishink-csrf-v1:' + token);
  }
  private signature(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('base64url');
  }
  issuePreauth(res: Response): string {
    const value = `${randomBytes(32).toString('base64url')}.${Date.now() + 10 * 60_000}`;
    const token = `${value}.${this.signature(value)}`;
    this.cookie(res, this.preauthName, token, 600);
    return this.csrf(token);
  }
  checkCsrf(req: Request, preauth = false): void {
    this.checkOrigin(req, true);
    const cookies = this.cookies(req);
    const token = cookies.get(preauth ? this.preauthName : this.sessionName);
    const header = req.headers['x-csrf-token'];
    if (
      !token ||
      typeof header !== 'string' ||
      !sameSecret(header, this.csrf(token))
    )
      throw new ApiError(403, 'csrf');
    if (preauth) {
      const parts = token.split('.');
      const value = parts.slice(0, 2).join('.');
      if (
        parts.length !== 3 ||
        !/^\d+$/.test(parts[1]) ||
        Number(parts[1]) <= Date.now() ||
        !sameSecret(parts[2], this.signature(value))
      )
        throw new ApiError(403, 'csrf-expired');
    }
  }
  cookie(res: Response, name: string, value: string, seconds: number): void {
    res.append(
      'Set-Cookie',
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${this.config.secure ? '; Secure' : ''}`,
    );
  }
}
