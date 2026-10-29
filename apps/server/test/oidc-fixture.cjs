// 合成发行方与真实编译后服务；只绑定 loopback，绝不能用于真实账号或部署。
const { createServer, request } = require('node:http');
const {
  generateKeyPairSync,
  createHash,
  randomUUID,
  sign,
} = require('node:crypto');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, extname, sep } = require('node:path');
const { StorageDatabase } = require('../dist/storage/storage-database');
const { manageAccount } = require('../dist/auth/local-auth');
const { createApplication } = require('../dist/http/create-application');
const { WorkspaceRuntime } = require('../dist/http/workspace-runtime');

const password = 'synthetic-oidc-password';
const clientSecret = 'synthetic-oidc-client-secret';
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    );
  });
const closeServer = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
function key(kid) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    ...pair,
    kid,
    jwk: {
      ...pair.publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'RS256',
      use: 'sig',
    },
  };
}
function jwt(claims, signer, kid = signer.kid) {
  const input =
    Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify(claims)).toString('base64url');
  return (
    input +
    '.' +
    sign('RSA-SHA256', Buffer.from(input), signer.privateKey).toString(
      'base64url',
    )
  );
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('fixture input limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}
function json(res, value, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

async function createOidcFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'radishink-oidc-'));
  const directory = join(root, 'data');
  let app, publicServer, idp;
  try {
    const db = new StorageDatabase({
      directory,
      mode: 'accounts',
      initialize: true,
    });
    let alice, bob;
    try {
      alice = await manageAccount(
        db.connection,
        'init-admin',
        'alice',
        password,
      );
      bob = await manageAccount(db.connection, 'create-user', 'bob', password);
    } finally {
      db.close();
    }
    const state = {
      mode: 'normal',
      subject: 'radish-subject-one',
      email: 'shared@example.invalid',
      keys: [key('initial-key')],
      clientSecret,
      jwksRequests: 0,
      tokenRequests: 0,
      requests: [],
      lastTokens: null,
    };
    const foreign = key('foreign-key');
    const codes = new Map(),
      access = new Map();
    let issuer;
    idp = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url, issuer);
        if (url.pathname === '/.well-known/openid-configuration') {
          if (state.mode === 'discovery-html') {
            res
              .writeHead(200, { 'Content-Type': 'text/html' })
              .end('<html>fallback</html>');
            return;
          }
          json(res, {
            issuer:
              state.mode === 'discovery-issuer' ? issuer + '/other' : issuer,
            authorization_endpoint: issuer + '/authorize',
            token_endpoint: issuer + '/token',
            jwks_uri: issuer + '/jwks',
            userinfo_endpoint: issuer + '/userinfo',
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported:
              state.mode === 'discovery-pkce' ? ['plain'] : ['S256'],
            token_endpoint_auth_methods_supported: [
              'client_secret_basic',
              'client_secret_post',
            ],
          });
          return;
        }
        if (url.pathname === '/jwks') {
          state.jwksRequests++;
          json(res, { keys: state.keys.map((k) => k.jwk) });
          return;
        }
        if (url.pathname === '/authorize') {
          state.requests.push(Object.fromEntries(url.searchParams));
          if (
            !url.searchParams.has('approve') &&
            !url.searchParams.has('cancel')
          ) {
            const approved = new URL(url),
              cancelled = new URL(url);
            approved.searchParams.set('approve', 'yes');
            cancelled.searchParams.set('cancel', 'yes');
            const escape = (value) =>
              value
                .replaceAll('&', '&amp;')
                .replaceAll('"', '&quot;')
                .replaceAll('<', '&lt;');
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            res.end(
              `<main><h1>合成 Radish 发行方</h1><p>仅用于本机测试，不能输入真实账号。</p><a href="${escape(approved.href)}">授权合成账号</a><br><a href="${escape(cancelled.href)}">取消授权</a></main>`,
            );
            return;
          }
          const callback = new URL(url.searchParams.get('redirect_uri'));
          if (
            callback.origin !== publicOrigin ||
            callback.pathname !== basePath + 'api/v1/auth/oidc/radish/callback'
          ) {
            json(res, { error: 'invalid_redirect_uri' }, 400);
            return;
          }
          callback.searchParams.set('state', url.searchParams.get('state'));
          if (url.searchParams.has('cancel'))
            callback.searchParams.set('error', 'access_denied');
          else {
            const code = randomUUID();
            codes.set(code, {
              redirect: callback.origin + callback.pathname,
              nonce: url.searchParams.get('nonce'),
              challenge: url.searchParams.get('code_challenge'),
              subject: state.subject,
              mode: state.mode,
            });
            callback.searchParams.set('code', code);
          }
          res
            .writeHead(302, {
              Location: callback.href,
              'Cache-Control': 'no-store',
            })
            .end();
          return;
        }
        if (url.pathname === '/token') {
          state.tokenRequests++;
          const form = new URLSearchParams(await body(req));
          const credentials = req.headers.authorization?.startsWith('Basic ')
            ? Buffer.from(req.headers.authorization.slice(6), 'base64')
                .toString()
                .split(':')
                .map(decodeURIComponent)
            : [form.get('client_id'), form.get('client_secret')];
          const code = codes.get(form.get('code'));
          codes.delete(form.get('code'));
          if (
            !code ||
            credentials[0] !== 'radishink-fixture' ||
            credentials[1] !== state.clientSecret ||
            form.get('grant_type') !== 'authorization_code' ||
            form.get('redirect_uri') !== code.redirect ||
            createHash('sha256')
              .update(form.get('code_verifier') ?? '')
              .digest('base64url') !== code.challenge
          ) {
            json(res, { error: 'invalid_grant' }, 400);
            return;
          }
          if (code.mode === 'timeout') return;
          if (code.mode === 'delayed')
            await new Promise((resolve) => {
              state.releaseToken = resolve;
            });
          if (code.mode === 'slow-body') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write('{"access_token":"');
            return;
          }
          if (code.mode === 'redirect') {
            res.writeHead(302, { Location: issuer + '/userinfo' }).end();
            return;
          }
          if (code.mode === 'oversized') {
            json(res, { data: 'x'.repeat(1024 * 1024 + 1) });
            return;
          }
          const now = Math.floor(Date.now() / 1000);
          const claims = {
            iss: issuer,
            sub: code.subject,
            aud: 'radishink-fixture',
            iat: now,
            exp: now + 300,
            nonce: code.nonce,
            auth_time: now,
            email: state.email,
            role: 'admin',
          };
          const mode = code.mode;
          if (mode === 'issuer') claims.iss += '/wrong';
          if (mode === 'audience') claims.aud = 'other-client';
          if (mode === 'azp') {
            claims.aud = ['radishink-fixture', 'another'];
            claims.azp = 'another';
          }
          if (mode === 'nonce') claims.nonce = 'wrong-nonce';
          if (mode === 'missing-nonce') delete claims.nonce;
          if (mode === 'expired') claims.exp = now - 120;
          if (mode === 'old-auth-time') claims.auth_time = now - 120;
          if (mode === 'missing-auth-time') delete claims.auth_time;
          if (mode === 'future-auth-time') claims.auth_time = now + 120;
          const signer = state.keys.at(-1);
          const idToken = jwt(
            claims,
            mode === 'signature' ? foreign : signer,
            signer.kid,
          );
          const accessToken = 'fixture-access-' + randomUUID();
          access.set(
            accessToken,
            mode === 'userinfo-sub' ? 'different-subject' : code.subject,
          );
          state.lastTokens = { idToken, accessToken };
          json(res, {
            access_token: accessToken,
            token_type: 'Bearer',
            ...(mode === 'missing-id-token' ? {} : { id_token: idToken }),
            expires_in: 300,
          });
          return;
        }
        if (url.pathname === '/userinfo') {
          const subject = access.get(
            req.headers.authorization?.replace(/^Bearer /, ''),
          );
          json(
            res,
            subject
              ? {
                  sub: subject,
                  email: state.email,
                  name: 'Mutable display name',
                }
              : { error: 'invalid_token' },
            subject ? 200 : 401,
          );
          return;
        }
        json(res, { error: 'not-found' }, 404);
      })().catch(() => {
        if (!res.headersSent) json(res, { error: 'fixture-error' }, 500);
        else res.destroy();
      });
    });
    issuer = await listen(idp);
    const basePath = options.basePath ?? '/';
    let apiPort;
    const webRoot = resolve(__dirname, '../../web/dist');
    publicServer = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith(basePath)) {
        res.writeHead(404).end();
        return;
      }
      const path = '/' + url.pathname.slice(basePath.length);
      if (path.startsWith('/api/')) {
        if (!apiPort) {
          res.writeHead(503).end();
          return;
        }
        const upstream = request(
          {
            hostname: '127.0.0.1',
            port: apiPort,
            method: req.method,
            path: path + url.search,
            headers: req.headers,
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
          },
        );
        upstream.on('error', () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        req.on('aborted', () => upstream.destroy());
        req.pipe(upstream);
        return;
      }
      if (!options.serveWeb) {
        res.writeHead(404).end();
        return;
      }
      try {
        const file = resolve(
          webRoot,
          '.' +
            decodeURIComponent(path.endsWith('/') ? path + 'index.html' : path),
        );
        if (!file.startsWith(webRoot + sep)) throw new Error('fixture path');
        let bytes = readFileSync(file);
        if (extname(file) === '.html')
          bytes = Buffer.from(
            bytes
              .toString()
              .replace(
                /(<script id="radishink-runtime-config" type="application\/json">)[\s\S]*?(<\/script>)/,
                `$1${JSON.stringify({ deployment: 'server', apiBase: basePath + 'api/v1' })}$2`,
              ),
          );
        const mime = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.webmanifest': 'application/manifest+json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.woff2': 'font/woff2',
        };
        res
          .writeHead(200, {
            'Content-Type': mime[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
          })
          .end(bytes);
      } catch {
        res.writeHead(404).end();
      }
    });
    let publicOrigin;
    if (options.port) {
      await new Promise((resolve, reject) => {
        publicServer.once('error', reject);
        publicServer.listen(options.port, '127.0.0.1', resolve);
      });
      publicOrigin = `http://127.0.0.1:${options.port}`;
    } else publicOrigin = await listen(publicServer);
    const config = {
      directory,
      origin: publicOrigin,
      port: publicServer.address().port,
      secure: false,
      basePath,
      passwordLogin: options.passwordLogin !== false,
      oidc: {
        issuer,
        clientId: 'radishink-fixture',
        clientSecret,
        clientAuth: options.clientAuth ?? 'client_secret_basic',
        admission: options.admission ?? 'approval',
      },
    };
    app = await createApplication(config);
    await app.listen(0, '127.0.0.1');
    apiPort = app.getHttpServer().address().port;
    const fixture = {
      root,
      directory,
      origin: publicOrigin,
      issuer,
      basePath,
      config,
      state,
      password,
      alice,
      bob,
      runtime: app.get(WorkspaceRuntime),
      rotateKey: () => state.keys.push(key('rotated-key-' + randomUUID())),
      restartApi: async () => {
        await app.close();
        app = await createApplication(config);
        await app.listen(0, '127.0.0.1');
        apiPort = app.getHttpServer().address().port;
        fixture.runtime = app.get(WorkspaceRuntime);
      },
      close: async () => {
        await closeServer(publicServer);
        await app.close();
        await closeServer(idp);
        rmSync(root, { recursive: true, force: true });
      },
    };
    return fixture;
  } catch (error) {
    if (publicServer?.listening) await closeServer(publicServer);
    if (app) await app.close();
    if (idp?.listening) await closeServer(idp);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { createOidcFixture };
