import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { generateImageNotices } from "./image-notices.mjs";
import { catalog, digest, fetchSources } from "./materials.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "radishink-image-notices-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, bytes) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  };
  const json = (file, object) => write(file, `${JSON.stringify(object)}\n`);
  write("LICENSE", "Project terms\n");
  write(
    "LICENSES/WeMD-MIT.txt",
    fs.readFileSync(new URL("../../LICENSES/WeMD-MIT.txt", import.meta.url)),
  );
  write(
    "LICENSES/distribution/server-scope.txt",
    "Earlier MIT and new original expression retain their own terms.\n",
  );
  write("LICENSES/native.txt", "Original native notice\n");
  const sources = ["vips", "sharp-libvips-build", "rust-example-1.0.0"].map(
    (id) => {
      write(`sources/${id}.tar`, `${id} source archive\n`);
      return {
        id,
        version:
          id === "sharp-libvips-build"
            ? "1.3.4"
            : id === "vips"
              ? "8.18.7"
              : "1.0.0",
        url: `https://example.test/${id}`,
        file: `${id}.tar`,
        sha256: digest(`${id} source archive\n`),
        notices: [
          {
            file: "LICENSES/native.txt",
            sha256: digest("Original native notice\n"),
            path: "LICENSE",
          },
        ],
      };
    },
  );
  const lock = `[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+https://example.test"\nchecksum = "${sources[2].sha256}"\n`;
  write("LICENSES/Cargo.lock", lock);
  const native = {
    schemaVersion: 1,
    packageVersion: "1.3.4",
    versions: { vips: "8.18.7" },
    rustLock: { file: "LICENSES/Cargo.lock", sha256: digest(lock) },
    sources,
  };
  json("LICENSES/distribution/native-sources.json", native);
  json("LICENSES/distribution/npm-sources.json", { packages: {} });
  const pkg = (
    directory,
    metadata,
    license = "Installed grant and copyright\n",
  ) => {
    json(`modules/${directory}/package.json`, metadata);
    if (license !== null) write(`modules/${directory}/LICENSE`, license);
    return directory;
  };
  const binary = pkg(
    ".pnpm/libvips/node_modules/@img/sharp-libvips-linux-arm64",
    {
      name: "@img/sharp-libvips-linux-arm64",
      version: "1.3.4",
      license: "LGPL-3.0-or-later",
    },
    null,
  );
  json(`modules/${binary}/versions.json`, native.versions);
  write(`modules/${binary}/lib/libvips.so`, "native binary\n");
  const ordinary = pkg(".pnpm/example/node_modules/example", {
    name: "example",
    version: "1.0.0",
    license: "MIT",
  });
  const options = {
    root,
    modules: path.join(root, "modules"),
    sources: path.join(root, "sources"),
    output: path.join(root, "result"),
  };
  return {
    root,
    write,
    json,
    native,
    pkg,
    binary,
    ordinary,
    options,
    run: () => generateImageNotices(options),
    check: () => generateImageNotices({ ...options, check: true }),
  };
}

test("physical optional and bundled packages are included; generation and checks are reproducible", (t) => {
  const f = fixture(t);
  f.pkg(".pnpm/unused/node_modules/unused", {
    name: "unused-optional",
    version: "2.0.0",
  });
  f.pkg(`.pnpm/example/node_modules/example/node_modules/bundled`, {
    name: "bundled",
    version: "3.0.0",
  });
  assert.deepEqual(f.run(), { packageCount: 4, sourceCount: 3 });
  const first = fs.readFileSync(path.join(f.options.output, "checksums.json"));
  f.run();
  assert.deepEqual(
    fs.readFileSync(path.join(f.options.output, "checksums.json")),
    first,
  );
  f.check();
  generateImageNotices({
    ...f.options,
    sources: path.join(f.options.output, "sources"),
    check: true,
  });
  assert.match(
    fs.readFileSync(
      path.join(f.options.output, "third-party-notices.txt"),
      "utf8",
    ),
    /unused-optional@2.0.0/,
  );
});

test("README supplements pin both published evidence and full text", (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.options.modules, f.ordinary, "LICENSE"));
  f.write(`modules/${f.ordinary}/README.md`, "Published grant\n");
  f.write("LICENSES/supplement.txt", "Published grant\n");
  f.json("LICENSES/distribution/npm-sources.json", {
    packages: {
      "example@1.0.0": {
        file: "LICENSES/supplement.txt",
        sha256: digest("Published grant\n"),
        url: "https://example.test/source",
        provenance: "Full published README grant",
        packageFiles: { "README.md": digest("Published grant\n") },
      },
    },
  });
  f.run();
  f.write(`modules/${f.ordinary}/README.md`, "Changed grant\n");
  assert.throws(f.run, /SHA-256 mismatch/);
});

for (const [name, mutate, expected] of [
  [
    "missing package license",
    (f) => fs.unlinkSync(path.join(f.options.modules, f.ordinary, "LICENSE")),
    /Missing reviewed license/,
  ],
  [
    "empty package license",
    (f) => f.write(`modules/${f.ordinary}/LICENSE`, " \n"),
    /Empty installed license/,
  ],
  [
    "empty project license",
    (f) => f.write("LICENSE", " \n"),
    /Empty project license/,
  ],
  [
    "changed upstream grant",
    (f) => f.write("LICENSES/WeMD-MIT.txt", "changed\n"),
    /SHA-256 mismatch/,
  ],
  [
    "missing source archive",
    (f) => fs.unlinkSync(path.join(f.options.sources, "vips.tar")),
    /ENOENT/,
  ],
  [
    "corrupt source archive",
    (f) => f.write("sources/vips.tar", "corrupt"),
    /SHA-256 mismatch/,
  ],
  [
    "changed native versions",
    (f) => f.json(`modules/${f.binary}/versions.json`, { vips: "9.0.0" }),
    /Native component versions changed/,
  ],
  [
    "unreviewed native package",
    (f) =>
      f.pkg(".pnpm/native/node_modules/unknown", {
        name: "@img/sharp-libvips-linux-unknown",
        version: "1.3.4",
      }),
    /Unreviewed native binary/,
  ],
  [
    "missing component in catalog",
    (f) => {
      f.native.sources = f.native.sources.filter((s) => s.id !== "vips");
      f.json("LICENSES/distribution/native-sources.json", f.native);
    },
    /Missing native component source/,
  ],
  [
    "missing locked crate",
    (f) => {
      f.native.sources.pop();
      f.json("LICENSES/distribution/native-sources.json", f.native);
    },
    /Missing locked Rust source/,
  ],
  [
    "changed source notice",
    (f) => f.write("LICENSES/native.txt", "changed"),
    /SHA-256 mismatch/,
  ],
  [
    "path traversal",
    (f) => {
      f.native.sources[0].file = "../outside";
      f.json("LICENSES/distribution/native-sources.json", f.native);
    },
    /escapes directory/,
  ],
  [
    "symlink source",
    (f) => {
      fs.unlinkSync(path.join(f.options.sources, "vips.tar"));
      fs.symlinkSync(
        path.join(f.options.sources, "sharp-libvips-build.tar"),
        path.join(f.options.sources, "vips.tar"),
      );
    },
    /Symlink/,
  ],
]) {
  test(`${name} fails without replacing prior output`, (t) => {
    const f = fixture(t);
    f.run();
    const before = fs.readFileSync(
      path.join(f.options.output, "checksums.json"),
    );
    mutate(f);
    assert.throws(f.run, expected);
    assert.deepEqual(
      fs.readFileSync(path.join(f.options.output, "checksums.json")),
      before,
    );
  });
}

test("check rejects binary drift, missing and additional output files", (t) => {
  const f = fixture(t);
  f.run();
  f.write(`modules/${f.binary}/lib/libvips.so`, "different binary\n");
  assert.throws(f.check, /Distribution material drift: packages.json/);
  f.run();
  f.write("result/unreviewed.txt", "extra\n");
  assert.throws(f.check, /Unexpected distribution material/);
  fs.unlinkSync(path.join(f.options.output, "unreviewed.txt"));
  fs.unlinkSync(path.join(f.options.output, "WeMD-LICENSE.txt"));
  assert.throws(f.check, /Missing distribution material/);
});

test("reviewed repository native catalog and notice digests are coherent", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  assert.doesNotThrow(() => catalog(root));
});

test("download failures and changed bytes leave no partial archives", async (t) => {
  const f = fixture(t);
  fs.rmSync(f.options.sources, { recursive: true });
  t.mock.method(https, "get", (_url, _options, callback) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Readable.from(["corrupted archive"]);
      response.statusCode = 200;
      callback(response);
    });
    return request;
  });
  await assert.rejects(
    fetchSources(f.root, f.options.sources),
    /Downloaded SHA-256 mismatch/,
  );
  assert.deepEqual(fs.readdirSync(f.options.sources), []);
});

test("verified cached archives work offline; corrupt caches fail without a network fallback", async (t) => {
  const f = fixture(t);
  const fetch = t.mock.method(https, "get", () => {
    throw new Error("network forbidden");
  });
  assert.equal(await fetchSources(f.root, f.options.sources), 3);
  f.write("sources/vips.tar", "corrupted cache");
  await assert.rejects(
    fetchSources(f.root, f.options.sources),
    /SHA-256 mismatch/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("generation refuses to replace its own source tree", (t) => {
  const f = fixture(t);
  assert.throws(
    () => generateImageNotices({ ...f.options, output: f.root }),
    /must not replace/,
  );
  assert.ok(fs.existsSync(path.join(f.root, "LICENSE")));
});

test("HTTP errors and insecure redirects fail with the original diagnostic and clean partials", async (t) => {
  for (const [status, location] of [
    [503, "https://example.test/source"],
    [302, "http://example.test/insecure"],
    [302, "https://user:password@example.test/source"],
    [302, "https://example.test/source#fragment"],
  ]) {
    const f = fixture(t);
    fs.rmSync(f.options.sources, { recursive: true });
    const mock = t.mock.method(https, "get", (_url, _options, callback) => {
      const request = new EventEmitter();
      queueMicrotask(() => {
        const response = Readable.from([]);
        response.statusCode = status;
        response.headers = { location };
        callback(response);
      });
      return request;
    });
    await assert.rejects(
      fetchSources(f.root, f.options.sources),
      status === 503 ? /HTTP 503/ : /Invalid or excessive source redirect/,
    );
    assert.deepEqual(fs.readdirSync(f.options.sources), []);
    mock.mock.restore();
  }
});
