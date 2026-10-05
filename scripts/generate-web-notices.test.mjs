import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateWebNotices } from "./generate-web-notices.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "radishink-notices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write("LICENSE", "Original project license\n");
  write(
    "apps/web/package.json",
    JSON.stringify({ name: "fixture-web", dependencies: { example: "1.0.0" } }),
  );
  write("packages/core/package.json", JSON.stringify({ name: "fixture-core" }));
  write(
    "apps/web/node_modules/example/package.json",
    JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }),
  );
  for (const file of [
    "fonts/maple-mono/LICENSE",
    "fonts/space-grotesk/OFL.txt",
    "fonts/jetbrains-mono/OFL.txt",
    "libs/mathjax/LICENSE",
  ]) {
    write(`apps/web/public/${file}`, `Asset license: ${file}\n`);
  }
  write(
    "apps/web/public/licenses/package-sources/sources.json",
    '{"packages":{}}\n',
  );
  const notices = () =>
    fs.readFileSync(
      path.join(root, "apps/web/public/licenses/third-party-notices.txt"),
      "utf8",
    );
  const supplemental = (text = "Reviewed license terms\n") => {
    const evidence = "Published README with full license\n";
    write("apps/web/node_modules/example/README.md", evidence);
    write("apps/web/public/licenses/package-sources/example.txt", text);
    write(
      "apps/web/public/licenses/package-sources/sources.json",
      JSON.stringify({
        packages: {
          "example@1.0.0": {
            file: "example.txt",
            url: "https://example.test/source/1.0.0",
            sha256: sha256(text),
            provenance: "Reviewed README excerpt",
            packageFiles: { "README.md": sha256(evidence) },
          },
        },
      }),
    );
  };
  return { root, write, notices, supplemental };
}

test("reads MIT-LICENSE.txt, retains notices, and generates reproducible output", (t) => {
  const f = fixture(t);
  f.write(
    "apps/web/node_modules/example/MIT-LICENSE.txt",
    "Published attribution\r\nGrant and disclaimer\r\n",
  );
  const summary = generateWebNotices(f.root);
  assert.deepEqual(summary, { packageCount: 1, assetCount: 4 });
  const first = f.notices();
  assert.match(
    first,
    /--- MIT-LICENSE.txt ---\nPublished attribution\nGrant and disclaimer/,
  );
  assert.match(first, /Missing license text review items: 0/);
  assert.ok(!first.includes("\r"));
  generateWebNotices(f.root);
  assert.equal(f.notices(), first);
  assert.equal(
    fs.readFileSync(
      path.join(f.root, "apps/web/public/licenses/WeMD-LICENSE.txt"),
      "utf8",
    ),
    "Original project license\n",
  );
});

test("includes reviewed README provenance and pinned source evidence", (t) => {
  const f = fixture(t);
  f.supplemental();
  generateWebNotices(f.root);
  assert.match(f.notices(), /Provenance: Reviewed README excerpt/);
  assert.match(
    f.notices(),
    /Published file: README.md \(SHA-256 [a-f0-9]{64}\)/,
  );
  assert.match(f.notices(), /Reviewed license terms/);
});

test("unreviewed metadata-only license fails without replacing existing notices", (t) => {
  const f = fixture(t);
  f.write(
    "apps/web/public/licenses/third-party-notices.txt",
    "Previous reviewed output\n",
  );
  assert.throws(
    () => generateWebNotices(f.root),
    /Missing reviewed license text: example@1.0.0/,
  );
  assert.equal(f.notices(), "Previous reviewed output\n");
});

test("changed supplemental text fails its pinned digest", (t) => {
  const f = fixture(t);
  f.supplemental();
  f.write(
    "apps/web/public/licenses/package-sources/example.txt",
    "Changed terms\n",
  );
  assert.throws(
    () => generateWebNotices(f.root),
    /Supplemental license hash mismatch/,
  );
});

test("changed published evidence invalidates the reviewed excerpt", (t) => {
  const f = fixture(t);
  f.supplemental();
  f.write(
    "apps/web/node_modules/example/README.md",
    "New license declaration\n",
  );
  assert.throws(
    () => generateWebNotices(f.root),
    /Published license evidence changed/,
  );
});

test("an empty supplemental notice cannot satisfy text coverage", (t) => {
  const f = fixture(t);
  f.supplemental("\n");
  assert.throws(() => generateWebNotices(f.root), /Empty license text/);
});

test("an empty installed license cannot satisfy text coverage", (t) => {
  const f = fixture(t);
  f.write("apps/web/node_modules/example/LICENSE", "\n");
  assert.throws(() => generateWebNotices(f.root), /Empty license text/);
});

test("supplemental paths cannot leave the source directory", (t) => {
  const f = fixture(t);
  f.supplemental();
  const file = path.join(
    f.root,
    "apps/web/public/licenses/package-sources/sources.json",
  );
  const sources = JSON.parse(fs.readFileSync(file, "utf8"));
  sources.packages["example@1.0.0"].file = "../../../../../../LICENSE";
  fs.writeFileSync(file, JSON.stringify(sources));
  assert.throws(
    () => generateWebNotices(f.root),
    /License source must stay inside/,
  );
});
