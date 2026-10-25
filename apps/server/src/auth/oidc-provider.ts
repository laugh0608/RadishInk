import type * as Oidc from 'openid-client';
import { ApiError } from '../http/api-error';
import { oidcUrl, type OidcConfig } from './oidc-config';

export interface OidcProof {
  state: string;
  nonce: string;
  verifier: string;
}
/** 标准校验交给 openid-client；这里只限制网络边界与本产品的认证策略。 */
export class OidcProvider {
  private cached: {
    expires: number;
    value: Promise<{ library: typeof Oidc; config: Oidc.Configuration }>;
  } | null = null;
  constructor(
    readonly settings: OidcConfig,
    readonly callback: string,
    readonly local: boolean,
  ) {}

  private async boundedFetch(
    url: string,
    options: Parameters<Oidc.CustomFetch>[1],
  ): Promise<Response> {
    oidcUrl(url, this.local);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(new ApiError(503, 'oidc-timeout'));
      }, 5000);
    });
    const request = async () => {
      const body =
        options.body instanceof Uint8Array
          ? new Uint8Array(options.body).buffer
          : options.body;
      const response = await fetch(url, {
        ...options,
        body,
        redirect: 'error',
        cache: 'no-store',
        signal: options.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal,
      });
      const chunks: Buffer[] = [];
      reader = response.body?.getReader();
      let size = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) {
            controller.abort();
            void reader.cancel().catch(() => {});
            throw new ApiError(503, 'oidc-response-limit');
          }
          chunks.push(Buffer.from(value));
        }
      return new Response(
        response.status === 204 ? null : Buffer.concat(chunks),
        { status: response.status, headers: response.headers },
      );
    };
    // Promise 的截止时间覆盖完整响应体；不能仅依赖传输实现对 abort 的响应。
    try {
      return await Promise.race([request(), expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private configuration() {
    if (!this.cached || this.cached.expires <= Date.now()) {
      const value = this.discover();
      const cached = { expires: Date.now() + 15 * 60_000, value };
      this.cached = cached;
      void value.catch(() => {
        if (this.cached === cached) this.cached = null;
      });
    }
    return this.cached.value;
  }
  private async discover() {
    const library = await import('openid-client');
    const settings = this.settings;
    const issuer = oidcUrl(settings.issuer, this.local);
    const config = await library.discovery(
      issuer,
      settings.clientId,
      {
        client_secret: settings.clientSecret,
        id_token_signed_response_alg: 'RS256',
        default_max_age: 0,
      },
      settings.clientAuth === 'client_secret_basic'
        ? library.ClientSecretBasic(settings.clientSecret)
        : library.ClientSecretPost(settings.clientSecret),
      {
        timeout: 5,
        [library.customFetch]: (url, options) =>
          this.boundedFetch(url, options),
        execute: [
          library.enableNonRepudiationChecks,
          ...(this.local ? [library.allowInsecureRequests] : []),
        ],
      },
    );
    const metadata = config.serverMetadata();
    if (
      metadata.issuer !== settings.issuer ||
      !metadata.authorization_endpoint ||
      !metadata.token_endpoint ||
      !metadata.jwks_uri ||
      !metadata.response_types_supported?.includes('code') ||
      !metadata.id_token_signing_alg_values_supported?.includes('RS256') ||
      !metadata.code_challenge_methods_supported?.includes('S256') ||
      (metadata.token_endpoint_auth_methods_supported &&
        !metadata.token_endpoint_auth_methods_supported.includes(
          settings.clientAuth,
        ))
    )
      throw new ApiError(503, 'oidc-discovery-invalid');
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
      metadata.userinfo_endpoint,
    ])
      if (endpoint) oidcUrl(endpoint, this.local);
    return { library, config };
  }
  async authorization(proof: OidcProof): Promise<string> {
    const { library, config } = await this.configuration();
    return library.buildAuthorizationUrl(config, {
      redirect_uri: this.callback,
      scope: 'openid profile',
      response_type: 'code',
      response_mode: 'query',
      code_challenge: await library.calculatePKCECodeChallenge(proof.verifier),
      code_challenge_method: 'S256',
      state: proof.state,
      nonce: proof.nonce,
      max_age: '0',
      prompt: 'login',
    }).href;
  }
  async verify(callback: URL, proof: OidcProof): Promise<{ subject: string }> {
    const { library, config } = await this.configuration();
    const tokens = await library.authorizationCodeGrant(config, callback, {
      expectedState: proof.state,
      expectedNonce: proof.nonce,
      pkceCodeVerifier: proof.verifier,
      maxAge: 0,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 255 ||
      Array.from(claims.sub).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      typeof claims.auth_time !== 'number' ||
      claims.auth_time > Date.now() / 1000 + 30
    )
      throw new ApiError(403, 'oidc-claims-invalid');
    if (config.serverMetadata().userinfo_endpoint)
      await library.fetchUserInfo(config, tokens.access_token, claims.sub);
    // Token 仅存活于本次调用，不进入数据库、Cookie、业务 URL 或日志。
    return { subject: claims.sub };
  }
}
