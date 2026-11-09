import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";
import {
  apkPackages,
  collectInventory,
  inventoryPlan,
  verifyLocalBinding,
} from "./base-inventory.mjs";
import {
  buildSourceBundle,
  verifySourceBundle,
  sourceCoverage,
  validatePlan,
} from "./source-bundle.mjs";
import { archiveSources, verifySourceArchive } from "./source-archive.mjs";
import { digest } from "./materials.mjs";
import {
  collectPair,
  deploymentLocks,
  pairRecord,
  verifyGitSource,
} from "./release-pair.mjs";
import {
  contentDigest,
  immutableTagCheck,
  INDEX_TYPES,
  MANIFEST_TYPES,
  registryClient,
} from "./registry.mjs";
import { SOURCE } from "../deployment/release-config.mjs";

const tag = "v26.10.2-dev",
  revision = "a".repeat(40);
test("release records bind an existing immutable Git tag to clean committed source", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "radishink-release-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git(["init", "--quiet"]);
  fs.writeFileSync(
    path.join(root, "version.json"),
    JSON.stringify({ version: "26.10.2", track: "dev" }) + "\n",
  );
  git(["add", "version.json"]);
  git(["commit", "--quiet", "-m", "test: synthetic source"]);
  const original = git(["rev-parse", "HEAD"]);
  assert.throws(() => verifyGitSource(root, tag, original), /Existing Git tag/);
  git(["tag", "-a", tag, "-m", "Synthetic annotated tag"]);
  verifyGitSource(root, tag, original);
  fs.writeFileSync(path.join(root, "pending"), "uncommitted");
  assert.throws(() => verifyGitSource(root, tag, original), /clean source/);
  fs.unlinkSync(path.join(root, "pending"));
  git(["commit", "--quiet", "--allow-empty", "-m", "test: later source"]);
  assert.throws(
    () => verifyGitSource(root, tag, git(["rev-parse", "HEAD"])),
    /moving tags is forbidden/,
  );
  assert.equal(git(["rev-parse", `refs/tags/${tag}^{commit}`]), original);
});
test("local image binding distinguishes containerd manifests from classic config IDs", () => {
  const manifest = { digest: `sha256:${"b".repeat(64)}` },
    config = {
      digest: `sha256:${"c".repeat(64)}`,
      json: {
        os: "linux",
        architecture: "arm64",
        rootfs: { type: "layers", diff_ids: [`sha256:${"d".repeat(64)}`] },
      },
    };
  const image = `ghcr.io/laugh0608/radishink-server@${manifest.digest}`;
  const inspected = {
    Id: manifest.digest,
    Descriptor: { digest: manifest.digest, mediaType: MANIFEST_TYPES[0] },
    RootFS: { Layers: config.json.rootfs.diff_ids },
    Os: "linux",
    Architecture: "arm64",
  };
  verifyLocalBinding(inspected, image, { manifest, config });
  const index = structuredClone(inspected);
  index.Descriptor.mediaType = INDEX_TYPES[0];
  assert.throws(
    () => verifyLocalBinding(index, image, { manifest, config }),
    /platform manifest differs/,
  );
  const classic = {
    ...inspected,
    Id: config.digest,
    Descriptor: undefined,
    RepoDigests: [image],
  };
  verifyLocalBinding(classic, image, { manifest, config });
  assert.throws(
    () =>
      verifyLocalBinding({ ...classic, Id: manifest.digest }, image, {
        manifest,
        config,
      }),
    /classic image config/,
  );
  assert.throws(
    () =>
      verifyLocalBinding({ ...inspected, RootFS: { Layers: [] } }, image, {
        manifest,
        config,
      }),
    /rootfs/,
  );
});
function sourcesFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "radishink-base-source-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = "Synthetic source / retained notice / recipe\n";
  const sha256 = digest(bytes);
  fs.writeFileSync(path.join(directory, "source.txt"), bytes);
  const plan = inventoryPlan(
    ["server", "web"].flatMap((component) =>
      ["amd64", "arm64"].map((arch) => ({
        component,
        platform: `linux/${arch}`,
        components:
          component === "server"
            ? {
                packages: [],
                bundled: [
                  {
                    id: "node:v1",
                    ecosystem: "node",
                    name: "node",
                    version: "v1",
                    lookup: "https://example.test/source",
                  },
                ],
                entrypointSha256: sha256,
                node: { licenseSha256: sha256 },
                ...Object.fromEntries(
                  ["npm", "corepack", "yarn"].map((name) => [
                    name,
                    { licenses: { LICENSE: sha256 } },
                  ]),
                ),
              }
            : {
                packages: [],
                entrypoints: `${sha256}  /docker-entrypoint.sh\n`,
              },
      })),
    ),
  );
  const provision = {
    formatVersion: 1,
    entries: plan.requirements.map((requirement) => ({
      id: requirement.id,
      review:
        "Synthetic complete input for a negative/positive governance test.",
      rebuild:
        "Read the retained recipe and use synthetic inputs in an isolated environment.",
      files: [
        {
          file: "source.txt",
          url: "https://example.test/source.txt",
          sha256,
          size: Buffer.byteLength(bytes),
          roles: ["source", "recipe", "notice"],
        },
      ],
    })),
  };
  return { directory, plan, provision, sha256 };
}

test("installed APK origin/commit identities retain vendor exceptions and reject missing origins", () => {
  const packages = apkPackages(
    "P:musl\nV:1-r0\no:musl\nc:abcdef\nL:MIT\n\nP:nginx\nV:2-r1\no:nginx\nL:BSD\n",
  );
  assert.equal(packages[0].commit, "abcdef");
  assert.equal(packages[1].commit, null);
  assert.equal(packages[0].license, "MIT");
  assert.throws(
    () => collectInventory("server", "--privileged"),
    /Invalid local image reference/,
  );
  assert.throws(() => apkPackages("P:x\nV:1\n"), /Incomplete/);
  assert.throws(
    () => apkPackages("P:x\nV:1\no:x\n\nP:x\nV:2\no:x"),
    /duplicate/,
  );
});

test("source coverage requires every base identity, archived bytes and retained notices", (t) => {
  const f = sourcesFixture(t);
  assert.equal(sourceCoverage(f.plan, f.provision, f.directory).length, 1);
  const missing = structuredClone(f.provision);
  missing.entries.pop();
  assert.throws(
    () => sourceCoverage(f.plan, missing, f.directory),
    /Missing corresponding base sources/,
  );
  const noRecipe = structuredClone(f.provision);
  noRecipe.entries[0].files[0].roles = ["source", "notice"];
  assert.throws(
    () => sourceCoverage(f.plan, noRecipe, f.directory),
    /Missing recipe/,
  );
  const duplicate = structuredClone(f.provision);
  duplicate.entries.push(duplicate.entries[0]);
  assert.throws(
    () => sourceCoverage(f.plan, duplicate, f.directory),
    /duplicate source/,
  );
  const unsafe = structuredClone(f.provision);
  unsafe.entries[0].files[0].file = "../source.txt";
  assert.throws(() => sourceCoverage(f.plan, unsafe, f.directory), /escapes/);
  fs.writeFileSync(path.join(f.directory, "source.txt"), "corrupt");
  assert.throws(
    () => sourceCoverage(f.plan, f.provision, f.directory),
    /SHA-256 mismatch/,
  );
});

test("source plan cannot silently omit an architecture, source identity or retained license", (t) => {
  const f = sourcesFixture(t);
  const missing = structuredClone(f.plan);
  missing.inventories.pop();
  assert.throws(() => validatePlan(missing), /inventories/);
  const rewritten = structuredClone(f.plan);
  rewritten.requirements.pop();
  assert.throws(() => validatePlan(rewritten), /differs/);
  const stale = structuredClone(f.plan.inventories);
  stale[0].components.node.licenseSha256 = "f".repeat(64);
  assert.throws(
    () => sourceCoverage(inventoryPlan(stale), f.provision, f.directory),
    /Retained base notice/,
  );
});

test("source companion packages actual bytes, verifies archives without extraction, rejects corruption and extra files", async (t) => {
  const f = sourcesFixture(t),
    root = path.join(f.directory, "repo"),
    nativeDirectory = path.join(f.directory, "native");
  fs.mkdirSync(path.join(root, "LICENSES/distribution"), { recursive: true });
  fs.mkdirSync(nativeDirectory);
  fs.writeFileSync(path.join(root, "LICENSE"), "Synthetic original terms\n");
  fs.writeFileSync(
    path.join(root, "LICENSES/Cargo.lock"),
    "# no registry packages\n",
  );
  const native = {
    schemaVersion: 1,
    packageVersion: "1",
    versions: { vips: "1" },
    rustLock: {
      file: "LICENSES/Cargo.lock",
      sha256: digest("# no registry packages\n"),
    },
    sources: ["vips", "sharp-libvips-build"].map((id) => {
      fs.writeFileSync(
        path.join(nativeDirectory, `${id}.tar`),
        id + " original source bytes\n",
      );
      return {
        id,
        version: "1",
        file: `${id}.tar`,
        url: `https://example.test/${id}`,
        sha256: digest(id + " original source bytes\n"),
      };
    }),
  };
  fs.writeFileSync(
    path.join(root, "LICENSES/distribution/native-sources.json"),
    JSON.stringify(native),
  );
  const output = path.join(f.directory, "companion"),
    archive = path.join(f.directory, "sources.tar.gz");
  const verified = buildSourceBundle({ ...f, root, nativeDirectory, output });
  assert.match(verified.manifestSha256, /^[a-f0-9]{64}$/);
  const artifact = await archiveSources(output, archive);
  assert.ok(
    execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .split("\n")
      .includes("bundle.json"),
  );
  assert.equal(artifact.size, fs.statSync(archive).size);
  assert.deepEqual(await verifySourceArchive(output, archive), artifact);
  const archive2 = path.join(f.directory, "again.tar.gz");
  assert.equal(
    (await archiveSources(output, archive2)).sha256,
    artifact.sha256,
  );
  const original = fs.readFileSync(archive),
    unpacked = gunzipSync(original);
  for (const [offset, value] of [
    [0, "../escape"],
    [156, "2"],
  ]) {
    const changed = Buffer.from(unpacked);
    changed.fill(0, offset, offset === 0 ? 100 : 157);
    changed.write(value, offset);
    changed.fill(32, 148, 156);
    changed.write(
      [...changed.subarray(0, 512)]
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
      8,
    );
    fs.writeFileSync(archive, gzipSync(changed));
    await assert.rejects(verifySourceArchive(output, archive));
  }
  fs.writeFileSync(archive, gzipSync(unpacked.subarray(0, 512)));
  await assert.rejects(verifySourceArchive(output, archive), /Truncated/);
  fs.writeFileSync(archive, original);
  assert.throws(
    () => buildSourceBundle({ ...f, root, nativeDirectory, output }),
    /already exists/,
  );
  fs.writeFileSync(path.join(output, "extra"), "untracked");
  assert.throws(() => verifySourceBundle(output), /extra source bundle/);
  fs.unlinkSync(path.join(output, "extra"));
  const raw = fs.readFileSync(archive);
  raw[Math.floor(raw.length / 2)] ^= 255;
  fs.writeFileSync(archive, raw);
  await assert.rejects(verifySourceArchive(output, archive));
  fs.writeFileSync(path.join(output, "base/source.txt"), "changed");
  assert.throws(() => verifySourceBundle(output), /SHA-256 mismatch/);
});

test("Debian .dsc requires exact source/version and every checksummed original and patch tar", (t) => {
  const f = sourcesFixture(t);
  for (const inventory of f.plan.inventories.filter(
    (i) => i.component === "server",
  ))
    inventory.components.packages = [
      {
        name: "binary",
        source: "example",
        sourceVersion: "1:2-3",
        sourceIndex: "https://snapshot.debian.org/",
      },
    ];
  f.plan = inventoryPlan(f.plan.inventories);
  const dsc = `Format: 3.0 (quilt)\nSource: example\nVersion: 1:2-3\nChecksums-Sha256:\n ${f.sha256} ${fs.statSync(path.join(f.directory, "source.txt")).size} source.txt\n`;
  fs.writeFileSync(path.join(f.directory, "example.dsc"), dsc);
  const entry = {
    ...f.provision.entries[0],
    id: "debian:example@1:2-3",
    files: [
      ...f.provision.entries[0].files,
      {
        file: "example.dsc",
        sha256: digest(dsc),
        size: Buffer.byteLength(dsc),
        url: "https://snapshot.debian.org/file/abc",
        roles: ["recipe"],
      },
    ],
  };
  f.provision.entries.push(entry);
  assert.equal(sourceCoverage(f.plan, f.provision, f.directory).length, 2);
  entry.files.pop();
  assert.throws(
    () => sourceCoverage(f.plan, f.provision, f.directory),
    /one Debian .dsc/,
  );
  entry.files.push({
    file: "example.dsc",
    sha256: digest(dsc),
    size: Buffer.byteLength(dsc),
    url: "https://example.test/example.dsc",
    roles: ["recipe"],
  });
  entry.files[0] = { ...entry.files[0], file: "renamed.txt" };
  fs.copyFileSync(
    path.join(f.directory, "source.txt"),
    path.join(f.directory, "renamed.txt"),
  );
  assert.throws(
    () => sourceCoverage(f.plan, f.provision, f.directory),
    /Incomplete Debian source set/,
  );
});

test("Alpine recipe is pinned to installed commit and retains every SHA-512 source and patch", (t) => {
  const f = sourcesFixture(t),
    commit = "b".repeat(40);
  for (const i of f.plan.inventories.filter((i) => i.component === "web"))
    i.components.packages = [
      { name: "example", version: "1-r0", origin: "example", commit },
    ];
  f.plan = inventoryPlan(f.plan.inventories);
  const checksum = createHash("sha512")
    .update(fs.readFileSync(path.join(f.directory, "source.txt")))
    .digest("hex");
  const recipe = `pkgname=example\npkgver=1\nsource="source.txt"\nsha512sums="\n${checksum}  source.txt\n"\n`;
  fs.writeFileSync(path.join(f.directory, "APKBUILD"), recipe);
  const entry = {
    ...f.provision.entries[0],
    id: `apk:example@1-r0#${commit}`,
    files: [
      ...f.provision.entries[0].files,
      {
        file: "APKBUILD",
        sha256: digest(recipe),
        size: Buffer.byteLength(recipe),
        url: `https://raw.githubusercontent.com/alpinelinux/aports/${commit}/main/example/APKBUILD`,
        roles: ["recipe"],
      },
    ],
  };
  f.provision.entries.push(entry);
  assert.equal(sourceCoverage(f.plan, f.provision, f.directory).length, 2);
  entry.files[1].url = entry.files[1].url.replace(commit, "main");
  assert.throws(
    () => sourceCoverage(f.plan, f.provision, f.directory),
    /commit mismatch/,
  );
  entry.files[1].url = entry.files[1].url.replace(
    "/aports/main/",
    `/aports/${commit}/`,
  );
  entry.files[0] = { ...entry.files[0], file: "renamed.txt" };
  fs.copyFileSync(
    path.join(f.directory, "source.txt"),
    path.join(f.directory, "renamed.txt"),
  );
  assert.throws(
    () => sourceCoverage(f.plan, f.provision, f.directory),
    /Incomplete APK source/,
  );
});

test("libyuv's exact distfile allowance rejects other bytes at the same URL", (t) => {
  const f = sourcesFixture(t);
  const commit = "6d055fa770a2fbbd807ee496c4dc8c69d00fbee4";
  const filename = "libyuv-0.0.1928.tar.gz";
  for (const inventory of f.plan.inventories.filter(
    (item) => item.component === "web",
  )) {
    inventory.components.packages = [
      { name: "libyuv", origin: "libyuv", version: "0.0.1928-r0", commit },
    ];
  }
  f.plan = inventoryPlan(f.plan.inventories);
  const source = "different archive";
  const recipe = `pkgname=libyuv\nsource="${filename}"\nsha512sums="\n${"a".repeat(128)}  ${filename}\n"\n`;
  fs.writeFileSync(path.join(f.directory, filename), source);
  fs.writeFileSync(path.join(f.directory, "APKBUILD"), recipe);
  f.provision.entries.push({
    ...f.provision.entries[0],
    id: `apk:libyuv@0.0.1928-r0#${commit}`,
    files: [
      {
        file: "APKBUILD",
        sha256: digest(recipe),
        size: Buffer.byteLength(recipe),
        url: `https://raw.githubusercontent.com/alpinelinux/aports/${commit}/main/libyuv/APKBUILD`,
        roles: ["recipe"],
      },
      {
        file: filename,
        sha256: digest(source),
        size: Buffer.byteLength(source),
        url: `https://distfiles.alpinelinux.org/distfiles/v3.24/${filename}`,
        roles: ["source", "notice"],
      },
    ],
  });
  assert.throws(
    () => sourceCoverage(f.plan, f.provision, f.directory),
    /Incomplete APK source\/patch set: apk:libyuv/,
  );
});

function registryFixture(t, sources) {
  const objects = new Map(),
    indices = {},
    configurations = new Map();
  const put = (json) => {
    const bytes = Buffer.from(JSON.stringify(json));
    const value = {
      bytes,
      json,
      digest: contentDigest(bytes),
      size: bytes.length,
    };
    objects.set(value.digest, value);
    return value;
  };
  for (const component of ["web", "server"]) {
    const children = ["amd64", "arm64"].map((arch) => {
      const config = put({
        os: "linux",
        architecture: arch,
        config: {
          User: component === "web" ? "nginx" : "node",
          Labels: {
            "org.opencontainers.image.version": tag,
            "org.opencontainers.image.revision": revision,
            "org.opencontainers.image.source": SOURCE,
          },
        },
      });
      configurations.set(`${component}/${arch}`, config);
      const child = put({
        schemaVersion: 2,
        mediaType: MANIFEST_TYPES[0],
        config: { digest: config.digest, size: config.size },
        layers: [],
      });
      return {
        digest: child.digest,
        size: child.size,
        mediaType: child.json.mediaType,
        platform: { os: "linux", architecture: arch },
      };
    });
    indices[component] = put({
      schemaVersion: 2,
      mediaType: INDEX_TYPES[0],
      manifests: children,
    });
  }
  const tags = new Map();
  const client = {
    manifest: async (repo, ref, options) => {
      if (ref === tag) {
        if (!tags.has(repo) && options?.absent) return null;
        return tags.get(repo);
      }
      const item = objects.get(ref);
      if (!item) throw Error("Unknown fixture digest");
      return item;
    },
    blob: async (_repo, ref) => objects.get(ref),
  };
  return {
    objects,
    indices,
    tags,
    configurations,
    client,
    options: {
      tag,
      revision,
      sourceUrl: `https://downloads.example.test/radishink-sources-${tag}.tar.gz`,
      sourceVersion: { version: "26.10.2", track: "dev" },
      digests: Object.fromEntries(
        Object.entries(indices).map(([name, value]) => [name, value.digest]),
      ),
      sources: {
        manifestSha256: "f".repeat(64),
        plan: sources.plan,
        archive: {
          file: `radishink-sources-${tag}.tar.gz`,
          sha256: "c".repeat(64),
          size: 1234,
        },
      },
      client,
      inventory: async (component, ref) => {
        const child = objects.get(ref.split("@")[1]);
        const config = objects.get(child.json.config.digest);
        return structuredClone(
          sources.plan.inventories.find(
            (i) =>
              i.component === component &&
              i.platform.endsWith(config.json.architecture),
          ),
        );
      },
    },
  };
}

test("paired record collects four configs and produces deployment locks from platform digests", async (t) => {
  const f = registryFixture(t, sourcesFixture(t));
  const record = await collectPair(f.options);
  assert.equal(record.images.web.digest, f.indices.web.digest);
  for (const [arch, lock] of Object.entries(deploymentLocks(record))) {
    assert.equal(
      lock.images.server.digest,
      record.images.server.platforms[`linux/${arch}`].digest,
    );
    assert.notEqual(lock.images.web.digest, record.images.web.digest);
  }
  const missing = structuredClone(record);
  delete missing.images.server;
  assert.throws(() => pairRecord(missing), /Incomplete paired/);
  const absent = structuredClone(record);
  delete absent.sources;
  assert.throws(() => pairRecord(absent), /source companion/);
  for (const url of [
    "http://example.test/source.tar.gz",
    record.sources.url + "?expires=1",
    "https://user:secret@example.test/" + record.sources.archive.file,
  ]) {
    const altered = structuredClone(record);
    altered.sources.url = url;
    assert.throws(() => pairRecord(altered));
  }
});

test("paired collection and tag checks run against a real read-only Registry V2 fixture", async (t) => {
  const f = registryFixture(t, sourcesFixture(t));
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "GET");
    const ref = req.url.split("/").at(-1),
      item = f.objects.get(ref);
    res.setHeader("Docker-Distribution-Api-Version", "registry/2.0");
    if (!item) {
      res.writeHead(404);
      res.end(JSON.stringify({ errors: [{ code: "MANIFEST_UNKNOWN" }] }));
      return;
    }
    res.setHeader("Content-Type", item.json.mediaType ?? "application/json");
    res.setHeader("Docker-Content-Digest", item.digest);
    res.end(item.bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = registryClient({
    origin: `http://127.0.0.1:${server.address().port}`,
    allowLoopback: true,
  });
  const record = await collectPair({ ...f.options, client });
  assert.deepEqual(
    (await immutableTagCheck(client, record)).map((item) => item.state),
    ["absent", "absent"],
  );
  assert.equal(Object.keys(deploymentLocks(record)).length, 2);
});

for (const failure of [
  "revision",
  "version",
  "architecture",
  "source",
  "index",
  "duplicate",
  "inventory",
  "user",
  "config-size",
]) {
  test(`paired collection rejects ${failure} drift without a partial record`, async (t) => {
    const f = registryFixture(t, sourcesFixture(t));
    const config = f.configurations.get("server/arm64");
    if (failure === "revision")
      config.json.config.Labels["org.opencontainers.image.revision"] =
        "b".repeat(40);
    if (failure === "version") f.options.sourceVersion.track = "test";
    if (failure === "architecture") config.json.architecture = "amd64";
    if (failure === "source")
      config.json.config.Labels["org.opencontainers.image.source"] =
        "https://example.test/other";
    if (failure === "index") f.indices.server.json.manifests.pop();
    if (failure === "duplicate")
      f.indices.server.json.manifests.push(f.indices.server.json.manifests[0]);
    if (failure === "inventory") f.options.inventory = async () => ({});
    if (failure === "user") config.json.config.User = "root";
    if (failure === "config-size") config.size += 1;
    await assert.rejects(collectPair(f.options));
  });
}

test("full tags permit absence/idempotent reuse and reject either component conflict on retries", async (t) => {
  const f = registryFixture(t, sourcesFixture(t)),
    record = await collectPair(f.options);
  assert.deepEqual(
    (await immutableTagCheck(f.client, record)).map((i) => i.state),
    ["absent", "absent"],
  );
  f.tags.set("laugh0608/radishink-web", f.indices.web);
  assert.deepEqual(
    (await immutableTagCheck(f.client, record)).map((i) => i.state),
    ["reuse", "absent"],
  );
  f.tags.set("laugh0608/radishink-server", {
    digest: `sha256:${"e".repeat(64)}`,
  });
  await assert.rejects(
    immutableTagCheck(f.client, record),
    /overwrite forbidden/,
  );
  // Rechecking detects changes after an earlier preflight; no write API exists.
  f.tags.set("laugh0608/radishink-server", f.indices.server);
  await immutableTagCheck(f.client, record);
  f.tags.set("laugh0608/radishink-web", { digest: `sha256:${"d".repeat(64)}` });
  await assert.rejects(
    immutableTagCheck(f.client, record),
    /Full tag conflict/,
  );
});

test("real Registry HTTP reader fails closed on auth, proxy errors, redirects and corrupt bytes", async (t) => {
  let mode = "missing";
  const json = { schemaVersion: 2, mediaType: INDEX_TYPES[0], manifests: [] },
    bytes = Buffer.from(JSON.stringify(json));
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, undefined);
    res.setHeader("Docker-Distribution-Api-Version", "registry/2.0");
    if (mode === "blob-redirect" && req.url.includes("/blobs/")) {
      res.writeHead(307, { Location: "/blob-content" });
      res.end();
      return;
    }
    if (mode === "blob-untrusted" && req.url.includes("/blobs/")) {
      res.writeHead(307, { Location: "http://127.0.0.2/blob-content" });
      res.end();
      return;
    }
    if (mode === "missing") {
      res.writeHead(404);
      res.end(JSON.stringify({ errors: [{ code: "MANIFEST_UNKNOWN" }] }));
    } else if (mode === "mixed-404") {
      res.writeHead(404);
      res.end(
        JSON.stringify({
          errors: [{ code: "MANIFEST_UNKNOWN" }, { code: "UNAUTHORIZED" }],
        }),
      );
    } else if (mode === "proxy") {
      res.writeHead(404);
      res.end("proxy missing");
    } else if (/^\d+$/.test(mode)) {
      res.writeHead(Number(mode));
      res.end("credential must not appear in diagnostics");
    } else {
      res.setHeader("Content-Type", INDEX_TYPES[0]);
      res.setHeader(
        "Docker-Content-Digest",
        mode === "bad-header"
          ? `sha256:${"d".repeat(64)}`
          : contentDigest(bytes),
      );
      res.end(mode === "malformed" ? "not-json" : bytes);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.throws(() => registryClient({ origin }), /HTTPS/);
  const client = registryClient({ origin, allowLoopback: true });
  assert.equal(
    await client.manifest("laugh0608/radishink-web", tag, { absent: true }),
    null,
  );
  for (mode of [
    "proxy",
    "mixed-404",
    "401",
    "403",
    "429",
    "500",
    "302",
    "bad-header",
    "malformed",
  ]) {
    await assert.rejects(
      client.manifest("laugh0608/radishink-web", tag, { absent: true }),
      (error) => !error.message.includes("credential must"),
    );
  }
  mode = "good";
  assert.equal(
    (await client.manifest("laugh0608/radishink-web", contentDigest(bytes)))
      .digest,
    contentDigest(bytes),
  );
  await assert.rejects(
    client.manifest("laugh0608/radishink-web", `sha256:${"e".repeat(64)}`),
    /digest mismatch/,
  );
  mode = "blob-redirect";
  assert.equal(
    (await client.blob("laugh0608/radishink-web", contentDigest(bytes))).digest,
    contentDigest(bytes),
  );
  mode = "blob-untrusted";
  await assert.rejects(
    client.blob("laugh0608/radishink-web", contentDigest(bytes)),
    /Untrusted blob redirect/,
  );
});

test("GHCR token credentials stay on the token endpoint and are dropped on blob redirects", async (t) => {
  const original = https.get;
  t.after(() => {
    https.get = original;
  });
  const bytes = Buffer.from(
    JSON.stringify({ architecture: "arm64", os: "linux" }),
  );
  let requests = 0;
  https.get = (url, options, callback) => {
    requests++;
    let status = 200,
      headers = {},
      body = bytes;
    if (url.pathname === "/token") {
      assert.equal(url.origin, "https://ghcr.io");
      assert.equal(
        options.headers.Authorization,
        `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`,
      );
      assert.equal(
        url.searchParams.get("scope"),
        "repository:laugh0608/radishink-web:pull",
      );
      body = Buffer.from(JSON.stringify({ token: "fixture-access-token" }));
    } else if (url.hostname === "pkg-containers.githubusercontent.com") {
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
    } else if (!options.headers.Authorization) {
      status = 401;
      headers = {
        "www-authenticate":
          'Bearer realm="https://ghcr.io/token",service="ghcr.io"',
      };
      body = Buffer.alloc(0);
    } else {
      assert.equal(
        options.headers.Authorization,
        "Bearer fixture-access-token",
      );
      status = 307;
      headers = {
        location:
          "https://pkg-containers.githubusercontent.com/fixture/config?signed=fixture",
      };
      body = Buffer.alloc(0);
    }
    const response = Readable.from([body]);
    response.statusCode = status;
    response.headers = headers;
    const request = new EventEmitter();
    queueMicrotask(() => callback(response));
    return request;
  };
  const client = registryClient({
    username: "fixture-user",
    password: "fixture-password",
  });
  assert.equal(
    (await client.blob("laugh0608/radishink-web", contentDigest(bytes))).digest,
    contentDigest(bytes),
  );
  assert.equal(requests, 4);
});
