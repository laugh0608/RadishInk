// 只访问容器内 readiness；Host 使用显式公开 Origin，不信任代理头。
const http = require("node:http");
const request = http.get(
  {
    hostname: "127.0.0.1",
    port: Number(process.env.PORT || 4000),
    path: "/api/v1/health/ready",
    headers: { Host: new URL(process.env.RADISHINK_ORIGIN).host },
    timeout: 2000,
  },
  (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  },
);
request.on("timeout", () => request.destroy());
request.on("error", () => {
  process.exitCode = 1;
});
