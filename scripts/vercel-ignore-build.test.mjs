import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("./vercel-ignore-build.mjs", import.meta.url),
);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "radishink-vercel-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git("init", "-b", "main");
  git("config", "user.name", "Synthetic Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  function commit(content) {
    writeFileSync(join(directory, "source.txt"), content);
    git("add", "source.txt");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      "test: synthetic",
    );
    return git("rev-parse", "HEAD");
  }
  const initial = commit("initial\n");
  function run(previous = initial, branch = "dev", cwd = directory) {
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_GIT_COMMIT_REF: branch,
        VERCEL_GIT_PREVIOUS_SHA: previous,
      },
    });
    assert.ifError(result.error);
    assert.match(result.stdout, /\[vercel-ignore-build\]/);
    return result.status;
  }
  return { directory, git, commit, initial, run };
}

test("pure merge backflow skips identical source despite a new SHA", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "dev");
  const deployed = f.commit("new source\n");
  f.git("switch", "main");
  f.git(
    "-c",
    "core.hooksPath=/dev/null",
    "merge",
    "--no-ff",
    "dev",
    "-m",
    "Merge dev",
  );
  f.git("switch", "dev");
  f.git("merge", "--ff-only", "main");
  assert.notEqual(f.git("rev-parse", "HEAD"), deployed);
  assert.equal(f.run(deployed), 0);
});

test("compares last successful deployment, not the unchanged immediate parent", (t) => {
  const f = fixture(t);
  f.commit("new source\n");
  f.commit("new source\n");
  assert.equal(f.run(), 1);
});

test("merge with actual source changes still builds", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "dev");
  const deployed = f.commit("dev\n");
  f.git("switch", "main");
  writeFileSync(join(f.directory, "hotfix.txt"), "hotfix\n");
  f.git("add", "hotfix.txt");
  f.git("-c", "core.hooksPath=/dev/null", "commit", "-m", "test: hotfix");
  f.git("switch", "dev");
  f.git("-c", "core.hooksPath=/dev/null", "merge", "main", "-m", "Merge main");
  assert.equal(f.run(deployed), 1);
});

test("first deployment, invalid input and unavailable history all build", (t) => {
  const f = fixture(t);
  for (const previous of ["", "HEAD", "--help", "a".repeat(40)]) {
    assert.equal(f.run(previous), 1, previous);
  }
});

test("non-dev and absent branch metadata preserve normal builds", (t) => {
  const f = fixture(t);
  for (const branch of ["main", "codex/example", ""]) {
    assert.equal(f.run(f.initial, branch), 1, branch);
  }
});

test("Git errors continue building instead of reporting an unchanged tree", (t) => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "radishink-vercel-no-git-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.equal(f.run(f.initial, "dev", outside), 1);
});
