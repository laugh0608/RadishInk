// 独立合成卷与本机端口；不接触现有 Compose 项目或真实账号。
// 先 docker compose -p radishink-p4-test build；再运行本脚本。
// --serve 在协议检查通过后保留测试入口，供 Playwright 验证；Ctrl-C 清理。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:https";
import { request } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(resolve("apps/server/package.json"));
const sharp = require("sharp");
const project = `radishink-p4-smoke-${process.pid}-${randomUUID().slice(0, 8)}`;
const temp = mkdtempSync(join(tmpdir(), "radishink-p4-smoke-"));
const origin = "https://127.0.0.1:4185";
const env = {
  ...process.env,
  RADISHINK_ORIGIN: origin,
  RADISHINK_BASE_PATH: "/nested/",
  RADISHINK_PORT: "4184",
  RADISHINK_ENV: "production",
  RADISHINK_PASSWORD_LOGIN: "true",
  RADISHINK_BIND: "127.0.0.1",
};
const override = join(temp, "compose.yml");
writeFileSync(
  override,
  `services:\n  server:\n    image: radishink-p4-test-server\n  web:\n    image: radishink-p4-test-web\n`,
);
const args = [
  "compose",
  "-p",
  project,
  "-f",
  resolve("docker-compose.yml"),
  "-f",
  override,
];
function docker(command, success = true) {
  const result = spawnSync("docker", command, {
    env,
    encoding: "utf8",
    timeout: 120000,
  });
  if (success)
    assert.equal(
      result.status,
      0,
      result.stderr || result.error?.message || result.stdout,
    );
  return result;
}
const compose = (command, success) => docker([...args, ...command], success);
let tls,
  staticStarted = false,
  cleaned = false;
const staticName = `${project}-static`;
const backupVolume = `${project}-backup`;
let backupVolumeCreated = false;
let restoredVolume = false;
let fixtureRecovery;
let activeDataDirectory = "/data/workspace";
function overrideText(mode) {
  return `services:\n  server:\n    image: radishink-p4-test-server\n    environment:\n      RADISHINK_DATA_DIR: ${activeDataDirectory}\n${restoredVolume ? "    volumes: [restored:/data]\n" : ""}  web:\n    image: radishink-p4-test-web\n${mode ? `    environment:\n      RADISHINK_DEPLOYMENT: ${mode}\n` : ""}${restoredVolume ? "volumes:\n  restored: {}\n" : ""}`;
}
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  tls?.closeAllConnections();
  if (tls?.listening) await new Promise((resolve) => tls.close(resolve));
  if (staticStarted) docker(["rm", "-f", staticName]);
  compose(["down", "--volumes", "--remove-orphans"]);
  // 切换到 restored 后，Compose 不再清理未引用的原 workspace 卷。
  // 同样覆盖恢复命令失败、overlay 尚未切换时创建的空目标卷。
  for (const name of [`${project}_workspace`, `${project}_restored`]) {
    const found = docker([
      "volume",
      "ls",
      "--filter",
      `name=^${name}$`,
      "--format",
      "{{.Name}}",
    ]).stdout.trim();
    if (found === name) docker(["volume", "rm", name]);
  }
  if (backupVolumeCreated) docker(["volume", "rm", backupVolume]);
  rmSync(temp, { recursive: true, force: true });
}
const check = (message) => console.log(`PASS ${message}`);
async function api(path, options = {}, identity) {
  // Node fetch 会覆盖 Host；用标准 http.request 保留受测的公开 Host，
  // FormData 则由 Request 编码，避免手工拼 multipart。
  const outgoing = new Request(origin + "/nested/api/v1" + path, {
    ...options,
    headers: {
      Host: new URL(origin).host,
      Origin: origin,
      ...(identity
        ? { Cookie: identity.cookie, "X-CSRF-Token": identity.csrf }
        : {}),
      ...options.headers,
    },
  });
  const bytes = outgoing.body
    ? Buffer.from(await outgoing.arrayBuffer())
    : undefined;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 4184,
        agent: false,
        path: "/nested/api/v1" + path,
        method: outgoing.method,
        headers: Object.fromEntries(outgoing.headers),
        timeout: 10000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, values] of Object.entries(response.headers))
            for (const value of Array.isArray(values) ? values : [values])
              if (value !== undefined) headers.append(name, value);
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("API timeout")));
    req.end(bytes);
  });
}
async function login(username) {
  const pre = await api("/auth/csrf");
  assert.equal(pre.status, 200, await pre.clone().text());
  const response = await api("/auth/login", {
    method: "POST",
    headers: {
      Cookie: pre.headers.getSetCookie()[0].split(";")[0],
      "X-CSRF-Token": (await pre.json()).csrfToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password: "synthetic-web-password" }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .find((v) => v.startsWith("__Host-radishink-session="));
  assert(cookie.includes("; Secure") && cookie.includes("; HttpOnly"));
  const session = await response.json();
  return { cookie: cookie.split(";")[0], csrf: session.csrfToken };
}
try {
  for (const setting of [
    "RADISHINK_BASE_PATH=/../",
    "RADISHINK_BASE_PATH=",
    "RADISHINK_DEPLOYMENT=",
    "RADISHINK_BASE_PATH=/\n};",
    "RADISHINK_DEPLOYMENT=unknown",
  ]) {
    const bad = docker(
      [
        "run",
        "--rm",
        "--read-only",
        "--tmpfs",
        "/tmp",
        "-e",
        setting,
        "radishink-p4-test-web",
      ],
      false,
    );
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /invalid/);
  }
  check("非法部署形态、路径穿越与多行配置注入均在启动前拒绝");
  docker([
    "run",
    "--rm",
    "--read-only",
    "--tmpfs",
    "/secrets:uid=1000,gid=1000,mode=0700",
    "radishink-p4-test-server",
    "node",
    "-e",
    `
    const fs=require('node:fs'), assert=require('node:assert/strict');
    const {serverConfig}=require('./dist/http/server-policy');
    const file='/secrets/client-secret';fs.writeFileSync(file,'synthetic-oidc-secret',{mode:0o600});
    const env={NODE_ENV:'production',RADISHINK_ORIGIN:'https://ink.example.invalid',RADISHINK_DATA_DIR:'/data/workspace',
      RADISHINK_OIDC_ENABLED:'true',RADISHINK_OIDC_ISSUER:'https://issuer.example.invalid',RADISHINK_OIDC_CLIENT_ID:'synthetic',RADISHINK_OIDC_CLIENT_SECRET_FILE:file};
    assert(serverConfig(env).oidc);fs.chmodSync(file,0o644);assert.throws(()=>serverConfig(env));
    fs.chmodSync(file,0o600);fs.symlinkSync(file,'/secrets/link');
    assert.throws(()=>serverConfig({...env,RADISHINK_OIDC_CLIENT_SECRET_FILE:'/secrets/link'}));
  `,
  ]);
  check("容器 UID 1000 可读取受控秘密文件，宽权限与符号链接拒绝");
  // 缺少数据不自动初始化，也不能开放监听。
  const empty = compose(
    ["run", "--rm", "-T", "--no-deps", "server", "node", "dist/main.js"],
    false,
  );
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /startup failed/);
  check("空卷启动明确失败");
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
    (async()=>{const db=new StorageDatabase({directory:'/data/workspace',mode:'accounts',initialize:true});
    try {await manageAccount(db.connection,'init-admin','alice','synthetic-web-password');
    await manageAccount(db.connection,'create-user','bob','synthetic-web-password');}
    finally {db.close()}})().catch(()=>process.exitCode=1);
  `,
  ]);
  compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
  const ps = compose(["ps", "-q"]).stdout.trim().split("\n");
  const states = JSON.parse(docker(["inspect", ...ps]).stdout);
  for (const state of states) {
    assert.notEqual(state.Config.User, "root");
    assert(state.Config.User);
    assert.equal(state.State.Health.Status, "healthy");
  }
  const server = states.find(
    (s) => s.Config.Labels["com.docker.compose.service"] === "server",
  );
  assert.equal(Object.keys(server.HostConfig.PortBindings || {}).length, 0);
  const conflict = compose(
    [
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "server",
      "node",
      "dist/storage/storage-cli.js",
      "check",
      "--data-dir",
      "/data/workspace",
      "--mode",
      "accounts",
    ],
    false,
  );
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /busy|locked/);
  check("非 root、readiness、无后端发布端口与卷独占锁");
  const html = await (await fetch("http://127.0.0.1:4184/nested/")).text();
  assert.match(html, /"apiBase":"\/nested\/api\/v1"/);
  const worker = await (
    await fetch("http://127.0.0.1:4184/nested/sw.js")
  ).text();
  assert(worker.includes(createHash("sha256").update(html).digest("hex")));
  const unknown = await api("/missing.png");
  assert.equal(unknown.headers.get("cache-control"), "no-store");
  assert(unknown.headers.get("content-type").includes("application/json"));
  assert.equal(
    (
      await api("/capabilities", {
        headers: {
          Host: "evil.invalid",
          "X-Forwarded-Host": new URL(origin).host,
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch("http://127.0.0.1:4184/api/v1/capabilities")).status,
    404,
  );
  check(
    "子路径配置、预缓存 revision、API 图片路由不进静态缓存及 Host 伪造拒绝",
  );
  assert.equal((await api("/articles/abc%2Fdef")).status, 422);
  const oversized = await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 4184,
        path: "/nested/api/v1/articles/oversized",
        method: "PUT",
        headers: {
          Host: new URL(origin).host,
          Origin: origin,
          "Content-Length": String(66 * 1024 * 1024 + 1),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            cache: response.headers["cache-control"],
          }),
        );
      },
    );
    req.on("error", reject);
    req.flushHeaders();
  });
  assert.deepEqual(oversized, { status: 413, cache: "no-store" });
  check("编码分隔符拒绝，反代超限请求返回 413 / no-store");
  const alice = await login("alice"),
    bob = await login("bob");
  const id = randomUUID();
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#ff6622" },
  })
    .png()
    .toBuffer();
  const body = new FormData();
  body.append(
    "manifest",
    JSON.stringify({
      operationId: randomUUID(),
      expectedRevision: null,
      metadata: {
        id,
        title: "compose-synthetic",
        savedAt: "2026-10-29T00:00:00Z",
        theme: "",
        themeName: "",
        customCSS: "",
      },
      assets: [
        {
          path: "asset/test.png",
          size: png.length,
          sha256: createHash("sha256").update(png).digest("hex"),
          partId: "image",
        },
      ],
    }),
  );
  body.append(
    "markdown",
    new Blob(["# Compose synthetic\n![image](asset/test.png)"]),
    "index.md",
  );
  body.append("image", new Blob([png]), "input.bin");
  const saved = await api(`/articles/${id}`, { method: "PUT", body }, alice);
  assert.equal(saved.status, 201, JSON.stringify(await saved.json()));
  assert.equal((await api(`/articles/${id}`, {}, bob)).status, 404);
  assert.equal(
    (await api(`/articles/${id}/assets/test.png?revision=0`, {}, bob)).status,
    404,
  );
  const image = await api(
    `/articles/${id}/assets/test.png?revision=0`,
    {},
    alice,
  );
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal(image.headers.get("cache-control"), "no-store");
  check("生产 Secure Cookie、文章/原图往返与跨账号隔离");
  compose(["down"]);
  compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
  const restored = await api(`/articles/${id}`, {}, alice);
  assert.equal(restored.status, 200);
  assert.match((await restored.json()).markdown, /Compose synthetic/);
  assert.deepEqual(
    Buffer.from(
      await (
        await api(`/articles/${id}/assets/test.png?revision=0`, {}, alice)
      ).arrayBuffer(),
    ),
    png,
  );
  check("完整停机重建后保留会话、归属、正文和原图，卷锁已释放");
  if (process.argv.includes("--recovery")) {
    // 备份介质与原卷/恢复卷独立；只用于此脚本的合成数据。
    docker(["volume", "create", backupVolume]);
    backupVolumeCreated = true;
    docker([
      "run",
      "--rm",
      "--mount",
      `type=volume,source=${backupVolume},target=/data`,
      "radishink-p4-test-server",
      "node",
      "-e",
      "require('node:fs').mkdirSync('/data/archives',{mode:0o700})",
    ]);
    const maintain = (
      command,
      destination = "/data/workspace",
      success = true,
      restored = false,
      backupPath = "/backups/archives/snapshot",
    ) =>
      compose(
        [
          "run",
          "--rm",
          "-T",
          "--no-deps",
          "--volume",
          `${backupVolume}:/backups:${command === "backup" ? "rw" : "ro"}`,
          ...(restored ? ["--volume", `${project}_restored:/data`] : []),
          "server",
          "node",
          "dist/storage/storage-cli.js",
          command,
          "--data-dir",
          destination,
          "--mode",
          "accounts",
          "--backup-dir",
          backupPath,
        ],
        success,
      );
    assert.notEqual(maintain("backup", undefined, false).status, 0);
    const oldCapabilities = await (await api("/capabilities")).json();
    compose(["stop", "web", "server"]);
    const backupResult = JSON.parse(maintain("backup").stdout);
    assert.equal(backupResult.articles, 1);
    assert.notEqual(maintain("restore", "/data/workspace", false).status, 0);
    const restoreResult = JSON.parse(
      maintain("restore", "/data/workspace", true, true).stdout,
    );
    assert.equal(restoreResult.deploymentId, oldCapabilities.deploymentId);
    assert.notEqual(
      restoreResult.workspaceEpoch,
      oldCapabilities.workspaceEpoch,
    );
    // 新服务明确挂载另一个卷；保留原卷供人工回退检查。
    compose(["down"]);
    restoredVolume = true;
    writeFileSync(override, overrideText());
    compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
    assert.equal((await api("/auth/session", {}, alice)).status, 401);
    const current = await login("alice");
    const restoredArticle = await (
      await api(`/articles/${id}`, {}, current)
    ).json();
    assert.match(restoredArticle.markdown, /Compose synthetic/);
    assert.deepEqual(
      Buffer.from(
        await (
          await api(`/articles/${id}/assets/test.png?revision=0`, {}, current)
        ).arrayBuffer(),
      ),
      png,
    );
    const currentBob = await login("bob");
    assert.equal((await api(`/articles/${id}`, {}, currentBob)).status, 404);
    const deletion = {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 0 }),
    };
    assert.equal((await api(`/articles/${id}`, deletion, alice)).status, 401);
    assert.equal(
      (
        await api(`/articles/${id}`, deletion, {
          ...alice,
          cookie: current.cookie,
        })
      ).status,
      403,
    );
    let browserBackedUp = false;
    let recoveryRound = 0;
    fixtureRecovery = (action) => {
      if (
        (action === "backup" && browserBackedUp) ||
        (action === "restore" && !browserBackedUp)
      )
        throw new Error("Invalid synthetic recovery phase");
      compose(["stop", "web", "server"]);
      if (action === "backup") recoveryRound++;
      const backupPath = `/backups/archives/browser-snapshot-${recoveryRound}`;
      const report = JSON.parse(
        maintain(
          action,
          action === "restore"
            ? `/data/browser-restored-${recoveryRound}`
            : activeDataDirectory,
          true,
          false,
          backupPath,
        ).stdout,
      );
      if (action === "restore") {
        activeDataDirectory = `/data/browser-restored-${recoveryRound}`;
        browserBackedUp = false;
      } else browserBackedUp = true;
      writeFileSync(override, overrideText());
      compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
      return report;
    };
    check(
      "独立备份卷 → 空命名卷恢复；部署 ID/归属/正文/原图保留，epoch 轮换，旧 Cookie 与旧 CSRF 拒绝写入",
    );
  }
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
      const recovery = /^\/__fixture\/recovery\/(backup|restore)$/.exec(
        req.url || "",
      );
      if (recovery && fixtureRecovery) {
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
            .end(JSON.stringify(fixtureRecovery(recovery[1])));
        } catch {
          res.writeHead(500).end("Synthetic recovery failed");
        }
        return;
      }
      // 仅合成验证进程拥有的 Compose 项目；公开产品没有此路由。
      const mode = /^\/__fixture\/deployment\/(static|server)$/.exec(
        req.url || "",
      )?.[1];
      if (mode) {
        if (
          req.method !== "POST" ||
          req.headers.origin !== origin ||
          req.headers.host !== new URL(origin).host
        ) {
          res.writeHead(403).end();
          return;
        }
        try {
          writeFileSync(override, overrideText(mode));
          compose([
            "up",
            "-d",
            "--no-build",
            "--no-deps",
            "--force-recreate",
            "--wait",
            "--wait-timeout",
            "30",
            "web",
          ]);
          res
            .writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            })
            .end(JSON.stringify({ mode }));
        } catch {
          res.writeHead(500).end("Synthetic web reconfiguration failed");
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
  await new Promise((resolve, reject) => {
    tls.once("error", reject);
    tls.listen(4185, "127.0.0.1", resolve);
  });
  docker([
    "run",
    "-d",
    "--name",
    staticName,
    "-p",
    "127.0.0.1:4186:8080",
    "radishink-p4-test-web",
  ]);
  staticStarted = true;
  // 独立静态镜像不用 tmpfs，覆盖 /tmp 保留时重启可重复生成配置。
  docker(["restart", staticName]);
  for (let i = 0; ; i++) {
    try {
      const response = await fetch("http://127.0.0.1:4186/");
      assert.equal(response.status, 200);
      break;
    } catch (error) {
      if (i === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.match(
    await (await fetch("http://127.0.0.1:4186/")).text(),
    /"deployment":"static"/,
  );
  assert.equal(
    (await fetch("http://127.0.0.1:4186/api/v1/capabilities")).status,
    404,
  );
  check("同一前端镜像静态模式无后端可启动");
  console.log(
    JSON.stringify({
      project,
      https: origin + "/nested/",
      static: "http://127.0.0.1:4186/",
      temp,
    }),
  );
  if (process.argv.includes("--serve")) {
    console.log(
      "等待浏览器验收；Ctrl-C / SIGTERM 清理本脚本容器、卷和 TLS 入口。",
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} finally {
  await cleanup();
}
