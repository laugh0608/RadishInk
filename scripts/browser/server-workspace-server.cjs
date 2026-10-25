// 合成数据专用：生产 Web 构建 + 正式 HTTP API，同源 loopback，无外部部署。
// mise exec -- node scripts/browser/server-workspace-server.cjs [port=4193]
const { createServer, request } = require("node:http");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join, extname, sep } = require("node:path");
const {
  StorageDatabase,
} = require("../../apps/server/dist/storage/storage-database");
const { manageAccount } = require("../../apps/server/dist/auth/local-auth");
const {
  createApplication,
} = require("../../apps/server/dist/http/create-application");

(async () => {
  const port = Number(process.argv[2] || 4193);
  const origin = `http://127.0.0.1:${port}`;
  const root = resolve(__dirname, "../../apps/web/dist");
  const directory = mkdtempSync(join(tmpdir(), "radishink-p3-web-"));
  const db = new StorageDatabase({
    directory,
    mode: "accounts",
    initialize: true,
  });
  try {
    await manageAccount(
      db.connection,
      "init-admin",
      "alice",
      "synthetic-web-password",
    );
    await manageAccount(
      db.connection,
      "create-user",
      "bob",
      "synthetic-web-password",
    );
  } finally {
    db.close();
  }
  const app = await createApplication({
    directory,
    origin,
    port,
    secure: false,
  });
  try {
    await app.listen(0, "127.0.0.1");
  } catch (error) {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const apiPort = app.getHttpServer().address().port;
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, origin);
    const nested = url.pathname.startsWith("/nested/");
    const staticMode = url.pathname.startsWith("/static/");
    const prefix = nested ? "/nested" : staticMode ? "/static" : "";
    const path = url.pathname.slice(prefix.length);
    if (path.startsWith("/api/")) {
      if (staticMode) {
        res.writeHead(404).end();
        return;
      }
      const upstream = request(
        {
          hostname: "127.0.0.1",
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
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    try {
      const file = resolve(
        root,
        `.${decodeURIComponent(path.endsWith("/") ? path + "index.html" : path)}`,
      );
      if (!file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      let bytes = readFileSync(file);
      if (extname(file) === ".html") {
        const config = staticMode
          ? { deployment: "static" }
          : { deployment: "server", apiBase: `${prefix}/api/v1` };
        bytes = Buffer.from(
          bytes
            .toString()
            .replace(
              /(<script id="radishink-runtime-config" type="application\/json">)[\s\S]*?(<\/script>)/,
              `$1${JSON.stringify(config)}$2`,
            ),
        );
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        // 公开应用壳不含私有正文，允许验证缓存与 BFCache；API 响应原样保持 no-store。
        "Cache-Control": "no-cache",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404).end("Fixture asset unavailable");
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  console.log(
    `Synthetic Web/API: ${origin} (/nested/ server, /static/ static); pid=${process.pid}; temporary=${directory}`,
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
