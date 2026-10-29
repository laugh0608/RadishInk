// 独立 Compose / 合成卷 / 临时 HTTPS；--serve 供浏览器验收，Ctrl-C 清理。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:https";
import { request } from "node:http";
const serverImage =
  process.env.RADISHINK_TEST_SERVER_IMAGE || "radishink-p4-test-server";
const webImage =
  process.env.RADISHINK_TEST_WEB_IMAGE || "radishink-p4-test-web";
const project = `radishink-p4-shared-${process.pid}`;
const temp = mkdtempSync(join(tmpdir(), "radishink-shared-"));
const origin = "https://127.0.0.1:4185";
const override = join(temp, "compose.yml");
let directory = "/data/workspace",
  mode = "shared",
  generation = 0;
const env = {
  ...process.env,
  RADISHINK_ORIGIN: origin,
  RADISHINK_PORT: "4184",
  RADISHINK_BIND: "127.0.0.1",
  RADISHINK_ENV: "production",
  RADISHINK_BASE_PATH: "/nested/",
};
function overlay() {
  writeFileSync(
    override,
    `services:\n  server:\n    image: ${JSON.stringify(serverImage)}\n    environment:\n      RADISHINK_DATA_DIR: ${directory}\n      RADISHINK_ACCOUNT_MODE: ${mode}\n      RADISHINK_PASSWORD_LOGIN: "${mode === "accounts"}"\n  web:\n    image: ${JSON.stringify(webImage)}\n`,
  );
}
function docker(args, expected = 0) {
  const result = spawnSync("docker", args, {
    env,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(
    result.status,
    expected,
    result.stderr || result.stdout || result.error?.message,
  );
  return result.stdout.trim();
}
const compose = (args) =>
  docker([
    "compose",
    "-p",
    project,
    "-f",
    resolve("docker-compose.yml"),
    "-f",
    override,
    ...args,
  ]);
const cli = (args) =>
  compose([
    "run",
    "--rm",
    "-T",
    "--no-deps",
    "server",
    "node",
    "dist/storage/storage-cli.js",
    ...args,
  ]);
const up = () =>
  compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
let tls,
  cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  tls?.closeAllConnections();
  if (tls?.listening) await new Promise((resolve) => tls.close(resolve));
  compose(["down", "--volumes", "--remove-orphans"]);
  rmSync(temp, { recursive: true, force: true });
}
process.once("SIGINT", () => void cleanup().then(() => process.exit()));
process.once("SIGTERM", () => void cleanup().then(() => process.exit()));
function transform(action) {
  compose(["stop", "web", "server"]);
  const previous = directory;
  const backup = `/data/backup-${++generation}`;
  const target = `/data/target-${generation}`;
  let result;
  if (action === "restore") {
    cli([
      "backup",
      "--data-dir",
      previous,
      "--mode",
      mode,
      "--backup-dir",
      backup,
    ]);
    result = JSON.parse(
      cli([
        "restore",
        "--data-dir",
        target,
        "--mode",
        mode,
        "--backup-dir",
        backup,
      ]),
    );
  } else {
    const account = JSON.parse(
      compose([
        "run",
        "--rm",
        "-T",
        "--no-deps",
        "server",
        "node",
        "-e",
        `
      const {StorageDatabase}=require('./dist/storage/storage-database');
      const {manageAccount}=require('./dist/auth/local-auth');
      (async()=>{const db=new StorageDatabase({directory:${JSON.stringify(previous)},mode:'shared'});
      try {const existing=db.connection.prepare("SELECT user_id AS userId FROM account_profiles WHERE username='recipient'").get();
      console.log(JSON.stringify(existing || await manageAccount(db.connection,'init-admin','recipient','synthetic-shared-password')));}finally{db.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
    `,
      ]),
    );
    result = JSON.parse(
      cli([
        "convert-mode",
        "--data-dir",
        previous,
        "--mode",
        "shared",
        "--target-mode",
        "accounts",
        "--owner-id",
        account.userId,
        "--target-dir",
        target,
        "--backup-dir",
        backup,
      ]),
    );
    mode = "accounts";
  }
  directory = target;
  overlay();
  up();
  return result;
}
try {
  overlay();
  cli(["init", "--data-dir", directory, "--mode", "shared"]);
  up();
  const openssl = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-keyout",
      join(temp, "key.pem"),
      "-out",
      join(temp, "cert.pem"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(openssl.status, 0);
  tls = createServer(
    {
      key: readFileSync(join(temp, "key.pem")),
      cert: readFileSync(join(temp, "cert.pem")),
    },
    (req, res) => {
      const action = /^\/__fixture\/(restore|accounts)$/.exec(
        req.url || "",
      )?.[1];
      if (action) {
        if (
          req.method !== "POST" ||
          req.headers.origin !== origin ||
          req.headers.host !== new URL(origin).host
        ) {
          res.writeHead(403).end();
          return;
        }
        try {
          res
            .writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            })
            .end(JSON.stringify(transform(action)));
        } catch (error) {
          console.error(error.message);
          res.writeHead(500).end("Synthetic transform failed");
        }
        return;
      }
      const upstream = request(
        {
          hostname: "127.0.0.1",
          port: 4184,
          path: req.url,
          method: req.method,
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
    },
  );
  await new Promise((resolve) => tls.listen(4185, "127.0.0.1", resolve));
  console.log(
    `PASS shared Compose ready ${origin}/nested/; project=${project}; pid=${process.pid}`,
  );
  if (process.argv.includes("--serve")) await new Promise(() => {});
} finally {
  await cleanup();
}
