const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fork } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const sharp = require('sharp');
const argon2 = require('argon2');
const { StorageDatabase } = require('../dist/storage/storage-database');
const { ArticleRepository } = require('../dist/storage/article-repository');
const { StorageMaintenance } = require('../dist/storage/storage-maintenance');
const { manageAccount, ARGON_OPTIONS } = require('../dist/auth/local-auth');
const { sha256 } = require('../dist/storage/storage-contract');
const capacity = process.argv.includes('--capacity');
const root = mkdtempSync(join(tmpdir(), 'radishink-http-runtime-'));
const directory = join(root, 'data');
const password = 'synthetic-runtime-password';
let child;
const metadata = (id) => ({
  id,
  savedAt: '2026-10-25T00:00:00Z',
  title: 'synthetic',
  theme: '',
  themeName: '',
  customCSS: '',
});
function form(id, assets, expectedRevision = null, markdown = 'synthetic') {
  const body = new FormData();
  body.append(
    'manifest',
    JSON.stringify({
      operationId: randomUUID(),
      expectedRevision,
      metadata: metadata(id),
      assets: assets.map((a, i) => ({
        path: a.path,
        size: a.bytes.length,
        sha256: sha256(a.bytes),
        partId: 'image' + i,
      })),
    }),
  );
  body.append('markdown', new Blob([markdown]), 'index.md');
  assets.forEach((a, i) =>
    body.append('image' + i, new Blob([a.bytes]), 'input.bin'),
  );
  return body;
}
async function main() {
  const hashStart = performance.now();
  const hashes = await Promise.all([
    argon2.hash(password, ARGON_OPTIONS),
    argon2.hash(password, ARGON_OPTIONS),
  ]);
  const argonTwoMs = performance.now() - hashStart;
  assert.notEqual(hashes[0], hashes[1]);
  assert(await argon2.verify(hashes[0], password));
  const db = new StorageDatabase({
    directory,
    mode: 'accounts',
    initialize: true,
  });
  let seedMs;
  try {
    const alice = await manageAccount(
      db.connection,
      'init-admin',
      'alice',
      password,
    );
    for (const name of ['bob', 'carol', 'dave'])
      await manageAccount(db.connection, 'create-user', name, password);
    if (capacity) {
      const repo = new ArticleRepository(db);
      const start = performance.now();
      for (let i = 0; i < 999; i++) {
        const id = randomUUID();
        repo.commit({
          ownerId: alice.userId,
          articleId: id,
          operationId: randomUUID(),
          expectedRevision: null,
          markdown: 'seed',
          metadata: metadata(id),
          assets: [],
        });
      }
      seedMs = performance.now() - start;
    }
  } finally {
    db.close();
  }
  child = fork(join(__dirname, 'http-runtime-server.cjs'), [directory], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const [ready] = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw new Error('server exited');
    }),
  ]);
  const origin = ready.origin;
  async function request(path, options = {}, login) {
    const headers = { Origin: origin, ...options.headers };
    if (login)
      Object.assign(headers, {
        Cookie: login.cookie,
        'X-CSRF-Token': login.csrf,
      });
    return fetch(origin + '/api/v1' + path, { ...options, headers });
  }
  async function login(name) {
    const pre = await request('/auth/csrf');
    const csrf = (await pre.json()).csrfToken;
    const result = await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: pre.headers.getSetCookie()[0].split(';')[0],
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({ username: name, password }),
    });
    assert.equal(result.status, 200);
    return {
      cookie: result.headers.getSetCookie()[0].split(';')[0],
      csrf: (await result.json()).csrfToken,
    };
  }
  const users = [];
  for (const name of ['alice', 'bob', 'carol', 'dave'])
    users.push(await login(name));
  const alice = users[0];
  const bob = users[1];
  const assets = [];
  for (const format of ['png', 'jpeg', 'webp', 'gif'])
    assets.push({
      path: 'asset/test.' + format,
      bytes: await sharp({
        create: { width: 8, height: 8, channels: 4, background: '#abcdef' },
      })
        .toFormat(format)
        .toBuffer(),
    });
  let payloadBytes;
  if (capacity) {
    assets.length = 0;
    for (let i = 0; i < 9; i++)
      assets.push({
        path: `asset/${i}.png`,
        bytes: await sharp(randomBytes(1500 * 1500 * 3), {
          raw: { width: 1500, height: 1500, channels: 3 },
        })
          .png()
          .toBuffer(),
      });
  }
  const markdown = capacity ? 'x'.repeat(5 * 1024 * 1024) : 'synthetic';
  payloadBytes = assets.reduce(
    (n, a) => n + a.bytes.length,
    Buffer.byteLength(markdown),
  );
  const ids = users.map(() => randomUUID());
  const start = performance.now();
  // 四个不同账号同时提交：整个请求生命周期都在四槽与逐用户锁内。
  const writes = users.map((user, i) =>
    request(
      '/articles/' + ids[i],
      { method: 'PUT', body: form(ids[i], assets, null, markdown) },
      user,
    ),
  );
  const healthStart = performance.now();
  assert.equal((await request('/health/live')).status, 200);
  const healthMs = performance.now() - healthStart;
  const responses = await Promise.all(writes);
  for (const res of responses) {
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
  }
  const commitMs = performance.now() - start;
  assert.equal((await request('/articles/' + ids[0], {}, bob)).status, 404);
  const image = await request(
    `/articles/${ids[0]}/assets/${assets[0].path.slice(6)}?revision=0`,
    {},
    alice,
  );
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), assets[0].bytes);
  assert.equal((await request('/articles/' + ids[0], {}, alice)).status, 200);
  if (capacity) {
    const extra = randomUUID();
    assert.equal(
      (
        await request(
          '/articles/' + extra,
          { method: 'PUT', body: form(extra, []) },
          alice,
        )
      ).status,
      507,
    );
  }
  const metricsReply = once(child, 'message');
  child.send('metrics');
  const [metrics] = await metricsReply;
  const exited = once(child, 'exit');
  child.send('close');
  const [code] = await exited;
  assert.equal(code, 0);
  child = undefined;
  const reopened = new StorageDatabase({ directory, mode: 'accounts' });
  let files;
  try {
    files = new StorageMaintenance(new ArticleRepository(reopened)).inspect();
  } finally {
    reopened.close();
  }
  process.stdout.write(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      mode: capacity ? 'near-capacity-four-writers' : 'native-http-smoke',
      argonTwoMs,
      seedMs,
      payloadMiBPerWriter: payloadBytes / 1024 / 1024,
      commitMs,
      healthMs,
      articles: files.articles,
      retainedMiB: files.physicalBytes / 1024 / 1024,
      ...metrics.metrics,
    }) + '\n',
  );
}
main()
  .catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  })
  .finally(() => {
    child?.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  });
