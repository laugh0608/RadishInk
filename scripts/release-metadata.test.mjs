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

test("paused Docker template validates before login and builds exclusively with generated metadata", () => {
  const workflow = parseYaml(
    readFileSync(
      join(root, ".github/workflows-disabled/docker-image.yml"),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.on, {
    push: { tags: ["v*-dev", "v*-test", "v*-release"] },
  });
  const steps = workflow.jobs["build-and-push"].steps;
  const index = steps.findIndex((step) => step.id === "meta");
  assert.ok(
    index >= 0 &&
      index <
        steps.findIndex((step) =>
          step.uses?.startsWith("docker/login-action@"),
        ),
  );
  const metadataStep = steps[index];
  assert.equal(metadataStep.env.RELEASE_TAG, "${{ github.ref_name }}");
  assert.equal(metadataStep.if, undefined);
  assert.equal(metadataStep["continue-on-error"], undefined);
  const build = steps.find((step) =>
    step.uses?.startsWith("docker/build-push-action@"),
  );
  assert.equal(build.with.tags, "${{ steps.meta.outputs.tags }}");
  assert.equal(build.with.labels, "${{ steps.meta.outputs.labels }}");

  const directory = mkdtempSync(join(tmpdir(), "radishink-release-"));
  const output = join(directory, "output");
  try {
    for (const tag of [
      "v26.10.1-dev",
      "v26.10.1.0501-test",
      "v26.10.1-release",
      "main",
      "v1.4.7",
      "v26.10.1-test\n",
    ]) {
      writeFileSync(output, "");
      const result = spawnSync(
        "bash",
        ["-e", "-o", "pipefail", "-c", metadataStep.run],
        {
          cwd: root,
          env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: output },
          encoding: "utf8",
        },
      );
      assert.ifError(result.error);
      const content = readFileSync(output, "utf8");
      if (["main", "v1.4.7", "v26.10.1-test\n"].includes(tag)) {
        assert.notEqual(result.status, 0, tag);
        assert.equal(content, "");
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.ok(content.includes(`tag=${tag}\n`));
        assert.ok(
          content.includes(`org.opencontainers.image.version=${tag}\n`),
        );
        assert.equal(
          content.includes(`${IMAGE_NAME}:latest\n`),
          tag.endsWith("-release"),
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Compose requires an explicit RadishInk image version instead of an upstream latest default", () => {
  const compose = parseYaml(
    readFileSync(join(root, "docker-compose.yml"), "utf8"),
  );
  assert.equal(
    compose.services.web.image,
    `${IMAGE_NAME}:\${RADISHINK_IMAGE_TAG:?Set RADISHINK_IMAGE_TAG to an existing full version tag}`,
  );
});
