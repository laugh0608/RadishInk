const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createOidcFixture } = require('./oidc-fixture.cjs');
const { approveOidcAccount } = require('../dist/auth/oidc-accounts');
const { manageAccount } = require('../dist/auth/local-auth');

class Browser {
  constructor(fixture) {
    this.f = fixture;
    this.cookies = new Map();
    this.csrf = '';
  }
  async request(url, init = {}) {
    const headers = new Headers(init.headers);
    headers.set(
      'Cookie',
      Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join(
        '; ',
      ),
    );
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const row of response.headers.getSetCookie()) {
      const pair = row.split(';')[0],
        index = pair.indexOf('=');
      if (row.includes('Max-Age=0')) this.cookies.delete(pair.slice(0, index));
      else this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  api(path, body, method) {
    return this.request(this.f.origin + this.f.basePath + 'api/v1' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        Origin: this.f.origin,
        'X-CSRF-Token': this.csrf,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async preauth() {
    this.csrf = (await (await this.api('/auth/csrf')).json()).csrfToken;
  }
  async local(name = 'alice') {
    await this.preauth();
    const response = await this.api('/auth/login', {
      username: name,
      password: this.f.password,
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    this.csrf = value.csrfToken;
    return value;
  }
  async session() {
    const response = await this.api('/auth/session');
    assert.equal(response.status, 200);
    const value = await response.json();
    this.csrf = value.csrfToken;
    return value;
  }
  async start(purpose = 'login') {
    if (purpose === 'login') await this.preauth();
    const response = await this.api('/auth/oidc/radish/start', { purpose });
    assert.equal(
      response.status,
      200,
      JSON.stringify(await response.clone().json()),
    );
    return (await response.json()).authorizationUrl;
  }
  async callback(url) {
    const response = await this.request(url, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(response.status, 303);
    const destination = new URL(
      response.headers.get('location'),
      this.f.origin,
    );
    assert.equal(destination.origin, this.f.origin);
    assert.equal(destination.pathname, this.f.basePath);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual([...destination.searchParams.keys()], ['radishink-auth']);
    return destination.searchParams.get('radishink-auth');
  }
  async oidc(purpose = 'login', cancel = false) {
    return this.callback(await authorize(await this.start(purpose), cancel));
  }
}
async function authorize(input, cancel = false) {
  const url = new URL(input);
  url.searchParams.set(cancel ? 'cancel' : 'approve', 'yes');
  const response = await fetch(url, { redirect: 'manual' });
  assert.equal(response.status, 302);
  return response.headers.get('location');
}
async function fixtureTest(callback, options) {
  const fixture = await createOidcFixture(options);
  try {
    await callback(fixture, new Browser(fixture));
  } finally {
    await fixture.close();
  }
}
function accounts(f) {
  return f.runtime.auth.db.prepare('SELECT * FROM account_profiles').all();
}
function attempts(f) {
  return f.runtime.auth.db.prepare('SELECT * FROM oidc_attempts').all();
}
async function writeArticle(browser, text) {
  const id = randomUUID(),
    form = new FormData();
  form.append(
    'manifest',
    JSON.stringify({
      operationId: randomUUID(),
      expectedRevision: null,
      metadata: {
        id,
        title: 'Synthetic private article',
        theme: 'default',
        themeName: '',
        customCSS: '',
        savedAt: new Date().toISOString(),
      },
      assets: [],
    }),
  );
  form.append('markdown', new Blob([text]), 'index.md');
  const response = await browser.request(
    browser.f.origin + browser.f.basePath + 'api/v1/articles/' + id,
    {
      method: 'PUT',
      headers: { Origin: browser.f.origin, 'X-CSRF-Token': browser.csrf },
      body: form,
    },
  );
  assert.equal(response.status, 201);
  return id;
}

nodeTest(
  '默认准入、重复身份、无自动管理员；授权参数和私有 Token 不持久化',
  () =>
    fixtureTest(async (f, b) => {
      assert.equal(await b.oidc(), 'pending');
      const pending = accounts(f).find((row) => row.admission === 'pending');
      assert.ok(pending);
      assert.equal(pending.role, 'user');
      assert.equal((await b.api('/articles')).status, 401);
      assert.equal(await b.oidc(), 'pending');
      assert.equal(accounts(f).length, 3);
      approveOidcAccount(f.runtime.auth.db, pending.username);
      assert.equal(await b.oidc(), 'signed-in');
      const identity = await b.session();
      assert.equal(identity.user.userId, pending.user_id);
      const request = f.state.requests.at(-1);
      assert.equal(request.scope, 'openid profile');
      assert.equal(request.max_age, '0');
      assert.equal(request.code_challenge_method, 'S256');
      assert.equal(request.response_type, 'code');
      assert.equal(request.prompt, 'login');
      const serialized = f.runtime.auth.db.serialize();
      for (const secret of [
        f.config.oidc.clientSecret,
        f.state.lastTokens.accessToken,
        f.state.lastTokens.idToken,
      ])
        assert.equal(serialized.includes(Buffer.from(secret)), false);
      assert.equal(
        f.runtime.auth.db
          .prepare('SELECT 1 FROM password_credentials WHERE user_id=?')
          .get(pending.user_id),
        undefined,
      );
      assert.equal(attempts(f).length, 0);
    }),
);

nodeTest('同邮箱两个外部身份不合并，文章 API 与资源归属沿用内部用户隔离', () =>
  fixtureTest(
    async (f, a) => {
      assert.equal(await a.oidc(), 'signed-in');
      const first = await a.session();
      const article = await writeArticle(a, '# private A');
      const b = new Browser(f);
      f.state.subject = 'second-subject';
      assert.equal(await b.oidc(), 'signed-in');
      const second = await b.session();
      assert.notEqual(first.user.userId, second.user.userId);
      assert.equal((await b.api('/articles/' + article)).status, 404);
      assert.deepEqual(await (await b.api('/articles')).json(), []);
      assert.equal((await a.api('/articles/' + article)).status, 200);
    },
    { admission: 'auto' },
  ),
);

nodeTest(
  '本地账号重新认证后绑定，双登录同一 ID；绑定冲突不合并，解绑撤销会话',
  () =>
    fixtureTest(async (f, a) => {
      const original = await a.local();
      const article = await writeArticle(a, '# local identity');
      const oldToken = a.cookies.get('radishink-dev-session');
      assert.equal(await a.oidc('link'), 'linked');
      assert.notEqual(a.cookies.get('radishink-dev-session'), oldToken);
      assert.equal((await a.session()).user.userId, original.user.userId);
      const external = new Browser(f);
      assert.equal(await external.oidc(), 'signed-in');
      assert.equal(
        (await external.session()).user.userId,
        original.user.userId,
      );
      assert.equal((await external.api('/articles/' + article)).status, 200);
      const b = new Browser(f);
      await b.local('bob');
      assert.equal(await b.oidc('link'), 'failed');
      assert.equal((await b.session()).user.userId, f.bob.userId);
      assert.equal(
        (await a.api('/auth/oidc/radish/unlink', { confirm: true })).status,
        403,
      );
      const reauth = await a.api('/auth/reauthenticate', {
        password: f.password,
      });
      assert.equal(reauth.status, 200);
      a.csrf = (await reauth.json()).csrfToken;
      assert.equal(
        (await a.api('/auth/oidc/radish/unlink', { confirm: true })).status,
        204,
      );
      assert.equal((await external.api('/articles/' + article)).status, 401);
      await a.local();
      assert.equal((await a.api('/articles/' + article)).status, 200);
    }),
);

nodeTest(
  '密码重新认证过期、绑定途中会话撤销、唯一 OIDC 登录方式均拒绝绕过',
  () =>
    fixtureTest(
      async (f, a) => {
        await a.local();
        f.runtime.auth.db
          .prepare('UPDATE sessions SET created_at=?')
          .run(Date.now() - 301000);
        assert.equal(
          (await a.api('/auth/oidc/radish/start', { purpose: 'link' })).status,
          403,
        );
        await a.local();
        const callback = await authorize(await a.start('link'));
        await manageAccount(f.runtime.auth.db, 'revoke-sessions', 'alice');
        assert.equal(await a.callback(callback), 'failed');
        const b = new Browser(f);
        assert.equal(await b.oidc(), 'signed-in');
        await b.session();
        assert.equal(
          (await b.api('/auth/oidc/radish/unlink', { confirm: true })).status,
          403,
        );
      },
      { admission: 'auto' },
    ),
);

nodeTest('禁用阻止 OIDC 再登录；本机恢复密码仍保留外部账号与文章归属', () =>
  fixtureTest(
    async (f, a) => {
      assert.equal(await a.oidc(), 'signed-in');
      const user = (await a.session()).user;
      const article = await writeArticle(a, '# preserved');
      await manageAccount(f.runtime.auth.db, 'disable', user.username);
      assert.equal((await a.api('/articles')).status, 401);
      assert.equal(await a.oidc(), 'failed');
      await manageAccount(
        f.runtime.auth.db,
        'reset-password',
        user.username,
        f.password,
      );
      await manageAccount(f.runtime.auth.db, 'enable', user.username);
      await a.local(user.username);
      assert.equal((await a.api('/articles/' + article)).status, 200);
    },
    { admission: 'auto' },
  ),
);

nodeTest('取消授权消费尝试且保留原本站会话，回调不能开放重定向', () =>
  fixtureTest(async (f, b) => {
    const original = await b.local();
    const token = b.cookies.get('radishink-dev-session');
    const callback = await authorize(await b.start('link'), true);
    assert.equal(await b.callback(callback), 'cancelled');
    assert.equal(await b.callback(callback), 'failed');
    assert.equal(b.cookies.get('radishink-dev-session'), token);
    assert.equal((await b.session()).user.userId, original.user.userId);
    await b.preauth();
    assert.equal(
      (
        await b.api('/auth/oidc/radish/start', {
          purpose: 'login',
          returnTo: 'https://evil.invalid',
        })
      ).status,
      422,
    );
  }),
);

nodeTest('错误浏览器绑定、state 重放与重复参数不建立会话', () =>
  fixtureTest(
    async (f, a) => {
      const callback = await authorize(await a.start());
      const b = new Browser(f);
      assert.equal(await b.callback(callback), 'failed');
      assert.equal(await a.callback(callback), 'failed');
      const next = new URL(await authorize(await a.start()));
      next.searchParams.append('state', next.searchParams.get('state'));
      assert.equal(await a.callback(next), 'failed');
      assert.equal((await a.api('/auth/session')).status, 401);
      assert.equal(f.state.tokenRequests, 0);
    },
    { admission: 'auto' },
  ),
);

nodeTest('过期、配置改变和服务重启后的尝试分别处理，消耗状态持久化', () =>
  fixtureTest(
    async (f, b) => {
      const expired = await authorize(await b.start());
      f.runtime.auth.db
        .prepare('UPDATE oidc_attempts SET expires_at=?')
        .run(Date.now() - 1);
      assert.equal(await b.callback(expired), 'failed');
      const persistent = await authorize(await b.start());
      await f.restartApi();
      assert.equal(await b.callback(persistent), 'signed-in');
      assert.equal(await b.callback(persistent), 'failed');
      const changed = await authorize(await b.start());
      f.state.clientSecret = 'rotated-synthetic-client-secret';
      assert.equal(await b.oidc(), 'failed');
      f.config.oidc.clientSecret = f.state.clientSecret;
      await f.restartApi();
      assert.equal(await b.callback(changed), 'failed');
      assert.equal(await b.oidc(), 'signed-in');
    },
    { admission: 'auto' },
  ),
);

nodeTest('授权码交换期间退出会撤销已消费但尚未完成的尝试', () =>
  fixtureTest(
    async (f, b) => {
      f.state.mode = 'delayed';
      const callback = await authorize(await b.start());
      const response = b.callback(callback);
      for (let i = 0; i < 100 && !f.state.releaseToken; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(typeof f.state.releaseToken, 'function');
      assert.equal(
        (await b.api('/auth/logout', undefined, 'POST')).status,
        204,
      );
      f.state.releaseToken();
      assert.equal(await response, 'failed');
      assert.equal((await b.api('/auth/session')).status, 401);
      assert.equal(accounts(f).length, 2);
    },
    { admission: 'auto' },
  ),
);

for (const mode of [
  'missing-id-token',
  'signature',
  'issuer',
  'audience',
  'azp',
  'nonce',
  'missing-nonce',
  'expired',
  'old-auth-time',
  'missing-auth-time',
  'future-auth-time',
  'userinfo-sub',
  'redirect',
  'oversized',
  'timeout',
  'slow-body',
]) {
  nodeTest(`真实 openid-client 拒绝 ${mode}，失败消费尝试且不降级`, () =>
    fixtureTest(
      async (f, b) => {
        f.state.mode = mode;
        const callback = await authorize(await b.start());
        const started = Date.now();
        assert.equal(await b.callback(callback), 'failed');
        if (['timeout', 'slow-body'].includes(mode))
          assert.ok(
            Date.now() - started < 10000,
            'OIDC 完整响应必须在 5 秒限时附近结束',
          );
        assert.equal(await b.callback(callback), 'failed');
        assert.equal(attempts(f).length, 0);
        assert.equal(accounts(f).length, 2);
        assert.equal((await b.api('/articles')).status, 401);
        await b.local();
        assert.equal((await b.api('/articles')).status, 200);
      },
      { admission: 'auto' },
    ),
  );
}
for (const mode of ['discovery-issuer', 'discovery-html', 'discovery-pkce']) {
  nodeTest(`能力发现拒绝 ${mode} 且清理启动失败的尝试`, () =>
    fixtureTest(async (f, b) => {
      f.state.mode = mode;
      await b.preauth();
      assert.equal(
        (await b.api('/auth/oidc/radish/start', { purpose: 'login' })).status,
        503,
      );
      assert.equal(attempts(f).length, 0);
      await b.local();
    }),
  );
}

nodeTest('仅 OIDC 能力、client_secret_post 与子路径回调使用真实协议', () =>
  fixtureTest(
    async (f, b) => {
      const capabilities = await (await b.api('/capabilities')).json();
      assert.deepEqual(capabilities.loginMethods, ['radish-oidc']);
      await b.preauth();
      assert.equal(
        (
          await b.api('/auth/login', {
            username: 'alice',
            password: f.password,
          })
        ).status,
        403,
      );
      assert.equal(await b.oidc(), 'signed-in');
      await b.session();
      assert.equal((await b.api('/articles')).status, 200);
    },
    {
      passwordLogin: false,
      admission: 'auto',
      clientAuth: 'client_secret_post',
      basePath: '/nested/',
    },
  ),
);

nodeTest('公钥轮换：真实验签缓存过冷却时间后重新获取 JWKS', (t) =>
  fixtureTest(
    async (f, b) => {
      assert.equal(await b.oidc(), 'signed-in');
      assert.equal(f.state.jwksRequests, 1);
      f.rotateKey();
      const now = Date.now();
      t.mock.method(Date, 'now', () => now + 61000); // 仅推进缓存逻辑时钟，HTTP 与签名仍真实执行。
      assert.equal(await b.oidc(), 'signed-in');
      assert.equal(f.state.jwksRequests, 2);
    },
    { admission: 'auto' },
  ),
);

nodeTest('不同浏览器流程的授权码不可交换，PKCE 失败后不能重放', () =>
  fixtureTest(
    async (f, a) => {
      const b = new Browser(f);
      const first = new URL(await authorize(await a.start()));
      const second = new URL(await authorize(await b.start()));
      const originalCode = first.searchParams.get('code');
      first.searchParams.set('code', second.searchParams.get('code'));
      assert.equal(await a.callback(first), 'failed');
      first.searchParams.set('code', originalCode);
      assert.equal(await a.callback(first), 'failed');
      assert.equal((await a.api('/articles')).status, 401);
      assert.equal(accounts(f).length, 2);
    },
    { admission: 'auto' },
  ),
);
