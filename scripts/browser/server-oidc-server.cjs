// 生产 Web + 真实 API + 本机合成发行方；两个临时实例覆盖双登录与仅 OIDC。
const { createOidcFixture } = require('../../apps/server/test/oidc-fixture.cjs');
(async () => {
  const fixtures = [];
  try {
    fixtures.push(await createOidcFixture({ port: 4194, basePath: '/nested/', serveWeb: true }));
    fixtures.push(await createOidcFixture({ port: 4195, basePath: '/nested/', serveWeb: true, passwordLogin: false, admission: 'auto' }));
  } catch (error) { for (const fixture of fixtures) await fixture.close(); throw error; }
  console.log(`Synthetic OIDC Web: 4194 dual login / approval, 4195 OIDC only / explicit auto; pid=${process.pid}`);
  console.log(`Temporary volumes: ${fixtures.map(f => f.root).join(', ')}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; for (const fixture of fixtures) await fixture.close(); };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
})().catch(error => { console.error(error.message); process.exitCode = 1; });
