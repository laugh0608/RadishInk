import { serverConfig } from './server-policy';

const env = {
  RADISHINK_DATA_DIR: '/data/workspace',
  RADISHINK_ORIGIN: 'https://ink.example.invalid',
};
it('默认 loopback，显式容器监听与公开 HTTPS 端口独立', () => {
  expect(serverConfig(env).host).toBe('127.0.0.1');
  expect(serverConfig({ ...env, RADISHINK_HOST: '0.0.0.0' })).toMatchObject({
    host: '0.0.0.0',
    port: 4000,
    secure: true,
  });
  expect(
    serverConfig({ ...env, RADISHINK_ORIGIN: 'http://127.0.0.1:8080' }),
  ).toMatchObject({
    port: 4000,
    secure: false,
  });
});
it('拒绝任意 bind、生产 HTTP、外网 HTTP 和损坏公开配置', () => {
  for (const patch of [
    { RADISHINK_HOST: '::' },
    { RADISHINK_HOST: 'localhost' },
    { RADISHINK_HOST: '' },
    { RADISHINK_ORIGIN: 'http://192.168.1.2:8080' },
    { RADISHINK_ORIGIN: 'https://ink.example.invalid/nested/' },
    { RADISHINK_ORIGIN: 'http://127.0.0.1:8080', NODE_ENV: 'production' },
    { RADISHINK_BASE_PATH: '/nested/../' },
    { RADISHINK_PASSWORD_LOGIN: 'false' },
  ])
    expect(() => serverConfig({ ...env, ...patch })).toThrow();
});
