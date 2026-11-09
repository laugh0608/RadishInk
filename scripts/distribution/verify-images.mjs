import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { values } = parseArgs({
  options: { server: { type: "string" }, web: { type: "string" } },
});
if (!values.server && !values.web)
  throw new Error("--server or --web image is required");
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "radishink-image-review-"),
);
try {
  // Mount only explicit public review inputs, never the workspace or its secrets.
  for (const name of [
    "LICENSE",
    "LICENSES",
    "scripts/distribution",
    "apps/web/public/licenses/package-sources",
  ])
    fs.cpSync(path.join(root, name), path.join(temporary, name), {
      recursive: true,
    });
  // The images' default users need to traverse the public, read-only mount.
  fs.chmodSync(temporary, 0o755);
  if (values.server) {
    console.log(
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--entrypoint",
        "node",
        "--mount",
        `type=bind,source=${temporary},target=/review,readonly`,
        values.server,
        "/review/scripts/distribution/image-notices.mjs",
        "--root",
        "/review",
        "--modules",
        "/app/node_modules",
        "--sources",
        "/app/distribution/sources",
        "--output",
        "/app/distribution",
        "--check",
      ]).trim(),
    );
    // Compare retained base notices against the final filesystem, not a builder.
    console.log(
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,size=32m",
        "--entrypoint",
        "sh",
        "--mount",
        `type=bind,source=${temporary},target=/review,readonly`,
        values.server,
        "-ec",
        "node /review/scripts/distribution/base-notices.mjs /tmp/base; diff -r /app/base-distribution /tmp/base; echo 'Server base notices verified'",
      ]).trim(),
    );
    const nativeSmoke = `
      const assert = require('node:assert/strict');
      const sharp = require('sharp');
      const Database = require('better-sqlite3');
      const argon2 = require('argon2');
      (async () => {
        const png = await sharp({create: {width: 2, height: 3, channels: 4, background: '#123456'}}).png().toBuffer();
        const metadata = await sharp(png).metadata();
        assert.equal(metadata.width, 2); assert.equal(metadata.height, 3);
        const db = new Database(':memory:');
        assert.equal(db.prepare('select 42 as n').get().n, 42); db.close();
        assert.ok(await argon2.verify(await argon2.hash('synthetic-image-check'), 'synthetic-image-check'));
        console.log('Final-image Sharp, SQLite and Argon2 smoke passed');
      })().catch(error => {console.error(error); process.exitCode = 1;});
    `;
    console.log(
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--entrypoint",
        "node",
        values.server,
        "-e",
        nativeSmoke,
      ]).trim(),
    );
  }
  if (values.web) {
    console.log(
      docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--entrypoint",
        "sh",
        "--mount",
        `type=bind,source=${temporary},target=/review,readonly`,
        values.web,
        "-ec",
        "cd /opt/radishink-base; sha256sum -c checksums >/dev/null; cmp alpine-installed /lib/apk/db/installed; cmp licenses/nginx/COPYRIGHT /usr/share/licenses/nginx/COPYRIGHT; cd /opt/radishink-web; sha256sum -c /opt/radishink-base/web-licenses-checksums >/dev/null; cmp licenses/WeMD-LICENSE.txt /review/LICENSES/WeMD-MIT.txt; cmp licenses/RadishInk-LICENSE.txt /review/LICENSE; test -s licenses/third-party-notices.txt; echo 'Web and base notices verified'",
      ]).trim(),
    );
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
