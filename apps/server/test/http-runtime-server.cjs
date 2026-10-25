// 独立服务进程：让容量探针测量服务 RSS，而非客户端 multipart 缓冲。
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { createApplication } = require('../dist/http/create-application');
(async () => {
  const config = {
    directory: process.argv[2],
    origin: 'http://127.0.0.1:4000',
    port: 4000,
    secure: false,
  };
  const app = await createApplication(config);
  await app.listen(0, '127.0.0.1');
  config.port = app.getHttpServer().address().port;
  config.origin = `http://127.0.0.1:${config.port}`;
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const cpu = process.cpuUsage();
  process.send({ origin: config.origin });
  process.on('message', (message) => {
    if (message === 'metrics')
      process.send({
        metrics: {
          peakRssMiB: process.resourceUsage().maxRSS / 1024,
          eventLoopMaxMs: delay.max / 1e6,
          eventLoopP99Ms: delay.percentile(99) / 1e6,
          cpuMs:
            Object.values(process.cpuUsage(cpu)).reduce((a, b) => a + b, 0) /
            1000,
        },
      });
    if (message === 'close')
      void app.close().then(() => {
        delay.disable();
        process.disconnect();
      });
  });
})().catch(() => {
  process.stderr.write('HTTP runtime startup failed\n');
  process.exitCode = 1;
});
