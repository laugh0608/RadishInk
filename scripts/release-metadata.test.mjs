import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseYaml } from "./check-repo.mjs";
import { IMAGE_NAME, releaseMetadata } from "./release-metadata.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/release-metadata.mjs");

test("CalVer accepts monthly sequence and optional DDXX without changing product version", () => {
  for (const tag of [
    "v26.1.1-dev",
    "v26.12.123-test",
    "v26.10.1.0101-release",
    "v26.10.1.3199-dev",
  ]) {
    const result = releaseMetadata(tag);
    assert.equal(
      result.productVersion,
      tag.slice(1).split("-")[0].split(".").slice(0, 3).join("."),
    );
    assert.equal(result.tag, tag);
  }
  assert.equal(releaseMetadata("v26.10.1.0501-test").build, "0501");
  assert.equal(releaseMetadata("v26.10.1-test").build, null);
});

test("new tags reject legacy SemVer, noncanonical fields, bad DDXX and output injection", () => {
  for (const tag of [
    undefined,
    "",
    "v1.4.7",
    "26.10.1-release",
    "v2026.10.1-release",
    "v26.0.1-test",
    "v26.13.1-test",
    "v26.01.1-test",
    "v26.10.0-test",
    "v26.10.01-test",
    "v26.10.1",
    "v26.10.1-beta",
    "v26.10.1-Release",
    "v26.10.1-rc.1",
    "v26.10.1+meta-release",
    "v26.10.1.0001-test",
    "v26.10.1.3201-test",
    "v26.10.1.0100-test",
    "v26.10.1.101-test",
    "v26.10.1.01100-test",
    "v26.10.1-test\n",
    "v26.10.1-test\ntag=unexpected",
    " v26.10.1-test",
    "v26.10.1-test ",
    `v26.10.${"1".repeat(128)}-release`,
  ])
    assert.throws(() => releaseMetadata(tag), /新 tag 必须/, String(tag));
});

for (const [track, aliases] of [
  ["dev", ["dev-latest"]],
  ["test", ["test-latest"]],
  ["release", ["release-latest", "latest"]],
]) {
  test(`${track} images keep full Git tag and update only the allowed aliases`, () => {
    const tag = `v26.10.1.0501-${track}`;
    const metadata = releaseMetadata(tag);
    assert.deepEqual(metadata.aliases, aliases);
    assert.deepEqual(
      metadata.tags,
      [tag, ...aliases].map((value) => `${IMAGE_NAME}:${value}`),
    );
    assert.equal(metadata.labels["org.opencontainers.image.version"], tag);
    assert.equal(metadata.image, "ghcr.io/laugh0608/radishink-web");
  });
}

test("CLI returns metadata and fails without emitting publication output for invalid input", () => {
  const good = spawnSync(process.execPath, [script, "--tag", "v26.10.1-test"], {
    encoding: "utf8",
  });
  assert.ifError(good.error);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).tag, "v26.10.1-test");
  for (const args of [
    [],
    ["--tag", "v1.4.7"],
    ["--tag", "v26.10.1-test", "--format", "invalid"],
    ["--tag", "v26.10.1-test", "unexpected"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.trim());
  }
});

test("server metadata uses the same full tag and binds OCI revision and source", () => {
  const value = releaseMetadata("v26.11.1-test", "server", "a".repeat(40));
  assert.equal(value.image, "ghcr.io/laugh0608/radishink-server");
  assert.ok(value.tags.every((tag) => tag.startsWith(value.image + ":")));
  assert.equal(
    value.labels["org.opencontainers.image.revision"],
    "a".repeat(40),
  );
  assert.throws(() => releaseMetadata("v26.11.1-test", "desktop"));
  assert.throws(() => releaseMetadata("v26.11.1-test", "server", "short"));
});

test("source product version and track mismatches cannot emit publication metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "radishink-source-version-"));
  try {
    const source = join(directory, "version.json");
    writeFileSync(
      source,
      JSON.stringify({ version: "26.11.1", track: "test" }),
    );
    for (const tag of ["v26.11.1-test", "v26.11.2-test", "v26.11.1-release"]) {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "--tag",
          tag,
          "--component",
          "server",
          "--revision",
          "a".repeat(40),
          "--source-version",
          source,
        ],
        { encoding: "utf8" },
      );
      if (tag === "v26.11.1-test")
        assert.equal(
          JSON.parse(result.stdout).image,
          "ghcr.io/laugh0608/radishink-server",
        );
      else {
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, "");
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local Compose builds both services without claiming unpublished release images", () => {
  const compose = parseYaml(
    readFileSync(join(root, "docker-compose.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(compose.services).sort(), ["server", "web"]);
  for (const service of Object.values(compose.services)) {
    assert.ok(service.build);
    assert.equal(service.image, undefined);
  }
  assert.equal(compose.services.server.ports, undefined);
  assert.equal(
    compose.services.web.depends_on.server.condition,
    "service_healthy",
  );
  assert.equal(
    compose.services.web.ports[0],
    "${RADISHINK_BIND:-127.0.0.1}:${RADISHINK_PORT:-8080}:8080",
  );
});
