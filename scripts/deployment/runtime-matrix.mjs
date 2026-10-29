// Run existing compiled-runtime probes against final images and fresh named volumes.
// Images must already be built. Each architecture runs serially; no registry writes.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const images = process.argv.slice(2);
if (!images.length)
  throw new Error("Usage: node runtime-matrix.mjs <server-image> [...]");
function docker(args, input) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0)
    throw new Error(
      `docker ${args[0]} failed: ${result.error?.message || result.status}`,
    );
  return result.stdout;
}
for (const image of images) {
  const volume = `radishink-p44-${randomUUID()}`;
  docker([
    "image",
    "inspect",
    "--format",
    "{{.Id}} {{.Os}}/{{.Architecture}}",
    image,
  ]);
  const platform = docker([
    "image",
    "inspect",
    "--format",
    "{{.Os}}/{{.Architecture}}",
    image,
  ]).trim();
  docker(["volume", "create", volume]);
  try {
    const common = [
      "run",
      "--platform",
      platform,
      "--rm",
      "--read-only",
      "--mount",
      `type=volume,source=${volume},target=/data`,
      "--mount",
      `type=bind,source=${resolve("apps/server/test")},target=/app/test,readonly`,
      "-e",
      "TMPDIR=/data",
    ];
    docker([
      ...common,
      "--tmpfs",
      "/full-volume:uid=1000,gid=1000,mode=0700,size=1m",
      "-e",
      "RADISHINK_TEST_FULL_VOLUME=/full-volume",
      image,
      "node",
      "test/storage-runtime.cjs",
    ]);
    docker([...common, image, "node", "test/http-runtime.cjs", "--capacity"]);
    docker(
      [
        "run",
        "--platform",
        platform,
        "--rm",
        "--read-only",
        "--tmpfs",
        "/data:uid=1000,gid=1000,mode=0700,size=64m",
        "--tmpfs",
        "/restore:uid=1000,gid=1000,mode=0700,size=1m",
        "-i",
        image,
        "node",
      ],
      readFileSync("scripts/deployment/recovery-faults.cjs", "utf8"),
    );
    docker(
      [
        "run",
        "--platform",
        platform,
        "--rm",
        "--read-only",
        "--tmpfs",
        "/data:uid=1000,gid=1000,mode=0700,size=64m",
        "-i",
        image,
        "node",
      ],
      readFileSync("scripts/deployment/shared-storage-checks.cjs", "utf8"),
    );
    console.log(`PASS runtime matrix ${image}`);
  } finally {
    docker(["volume", "rm", volume]);
  }
}
