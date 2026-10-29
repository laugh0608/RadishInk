import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('OIDC 编译产物使用真实 openid-client / HTTP / 签名与 SQLite，逐项协议负向验收', () => {
  // 独立 Node 进程运行 ESM 库，不把 Jest VM 的动态 import 行为当作产品运行时。
  const result = spawnSync(
    process.execPath,
    ['--test', resolve(__dirname, '../../test/oidc-protocol.cjs')],
    {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0)
    throw new Error(
      `OIDC protocol verification failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  expect(result.stdout).toContain('# fail 0');
  expect(result.error).toBeUndefined();
}, 130_000);
