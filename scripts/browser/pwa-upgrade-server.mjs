// Test-only server: immutable production builds, selected explicitly per test.
// node scripts/browser/pwa-upgrade-server.mjs /private/tmp/<fixture-root> [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve(process.argv[2] || "output/playwright/pwa-builds");
const port = Number(process.argv[3] || 4183);
const versions = new Set(["legacy", "new", "next"]);
let version = "legacy";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/__test/select" && req.method === "POST") {
      const next = url.searchParams.get("version");
      if (!versions.has(next)) {
        res.writeHead(400).end();
        return;
      }
      await stat(resolve(root, next, "index.html"));
      version = next;
      res.writeHead(200, { "Cache-Control": "no-store" }).end(version);
      return;
    }
    const base = resolve(root, version);
    // The same build also serves /nested/ to exercise relative deployment.
    let path = decodeURIComponent(url.pathname).replace(/^\/nested(?=\/)/, "");
    if (path.endsWith("/")) path += "index.html";
    const file = resolve(base, `.${path}`);
    if (!file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch (error) {
    res
      .writeHead(error.code === "ENOENT" ? 404 : 500)
      .end("Fixture unavailable");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `PWA fixtures: http://127.0.0.1:${port}; root=${root}; pid=${process.pid}`,
  ),
);
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
