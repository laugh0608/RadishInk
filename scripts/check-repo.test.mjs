import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkPrRoute,
  governanceErrors,
  loadGovernance,
  licenseErrors,
  parseYaml,
  textErrors,
  validCommitSubject,
} from "./check-repo.mjs";

const baseline = loadGovernance();
test("current repository contract is coherent", () => {
  assert.deepEqual(governanceErrors(baseline), []);
});

const mutations = [
  [
    "accidental release activation",
    (x) => x.activeWorkflows.push("release.yml"),
  ],
  [
    "push-triggered CI",
    (x) => {
      x.workflow.on.push = { branches: ["dev"] };
    },
  ],
  [
    "path filter leaving checks pending",
    (x) => {
      x.workflow.on.pull_request.paths = ["apps/web/**"];
    },
  ],
  [
    "aggregator skips after failures",
    (x) => {
      delete x.workflow.jobs["candidate-quality"].if;
    },
  ],
  [
    "missing Web dependency",
    (x) => {
      x.workflow.jobs["candidate-quality"].needs = ["repo-hygiene"];
    },
  ],
  [
    "masked aggregate failure",
    (x) => {
      x.workflow.jobs["candidate-quality"].steps[0].run += "\nexit 0\n";
    },
  ],
  [
    "component skipped",
    (x) => {
      x.workflow.jobs["web-quality"].if = "false";
    },
  ],
  [
    "lint failure ignored",
    (x) => {
      x.workflow.jobs["web-quality"].steps[4]["continue-on-error"] = true;
    },
  ],
  [
    "missing tests",
    (x) => {
      x.workflow.jobs["web-quality"].steps = x.workflow.jobs[
        "web-quality"
      ].steps.filter((s) => s.run !== "pnpm test:web");
    },
  ],
  [
    "mismatched required context",
    (x) => {
      x.ruleset.rules[3].parameters.required_status_checks[0].context =
        "Old CI";
    },
  ],
  [
    "unrestricted admin bypass",
    (x) => {
      x.ruleset.bypass_actors[0].bypass_mode = "always";
    },
  ],
  [
    "wrong protected branch",
    (x) => {
      x.ruleset.conditions.ref_name.include = ["refs/heads/master"];
    },
  ],
  [
    "squash introduced",
    (x) => {
      x.settings.allow_squash_merge = true;
    },
  ],
  [
    "dev deletion after merge",
    (x) => {
      x.settings.delete_branch_on_merge = true;
    },
  ],
  [
    "empty test script",
    (x) => {
      x.pkg.scripts["test:web"] = "echo passed";
    },
  ],
  [
    "wrong package manager",
    (x) => {
      x.pkg.packageManager = "pnpm@11.19.0";
    },
  ],
  [
    "wrong Vercel output",
    (x) => {
      x.vercel.outputDirectory = "dist";
    },
  ],
  [
    "main deployment re-enabled",
    (x) => {
      x.vercel.git.deploymentEnabled.main = true;
    },
  ],
  [
    "dev deployment disabled",
    (x) => {
      x.vercel.git.deploymentEnabled.dev = false;
    },
  ],
  [
    "builds unconditionally skipped",
    (x) => {
      x.vercel.ignoreCommand = "exit 0";
    },
  ],
];
for (const [name, mutate] of mutations) {
  test(`reject ${name}`, () => {
    const broken = structuredClone(baseline);
    mutate(broken);
    assert.notDeepEqual(governanceErrors(broken), []);
  });
}

test("actual aggregate shell rejects failed, cancelled, skipped and missing results", () => {
  const directory = mkdtempSync(join(tmpdir(), "radishink-governance-"));
  const step = baseline.workflow.jobs["candidate-quality"].steps[0];
  try {
    for (const repo of ["success", "failure", "cancelled", "skipped", ""]) {
      for (const web of ["success", "failure", "cancelled", "skipped", ""]) {
        const result = spawnSync(
          "bash",
          ["-e", "-o", "pipefail", "-c", step.run],
          {
            env: {
              ...process.env,
              REPO_RESULT: repo,
              WEB_RESULT: web,
              GITHUB_STEP_SUMMARY: join(directory, "summary"),
            },
          },
        );
        assert.ifError(result.error);
        assert.equal(
          result.status === 0,
          repo === "success" && web === "success",
          `${repo}/${web}`,
        );
      }
    }
    assert.match(
      readFileSync(join(directory, "summary"), "utf8"),
      /Repo Hygiene:/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PR routing allows daily dev work and main integration/hotfix only", () => {
  assert.equal(checkPrRoute("dev", "codex/fix-copy"), null);
  assert.equal(checkPrRoute("main", "dev"), null);
  assert.equal(checkPrRoute("main", "hotfix/copy"), null);
  assert.ok(checkPrRoute("main", "codex/new-feature"));
  assert.ok(checkPrRoute("main", "hotfix/"));
  assert.ok(checkPrRoute("master", "dev"));
});

test("commit policy preserves true merges, not forged merge titles", () => {
  assert.equal(validCommitSubject("fix(copy): 修复公式"), true);
  assert.equal(validCommitSubject("feat!: 改变存储格式"), true);
  assert.equal(validCommitSubject("Merge branch 'main'", 2), true);
  assert.equal(validCommitSubject("Merge branch 'main'", 1), false);
  assert.equal(validCommitSubject("update stuff"), false);
});

test("text rules catch BOM, CRLF, missing newline and trailing space", () => {
  assert.deepEqual(textErrors("ok.md", "说明  \n继续\n"), []);
  assert.ok(textErrors("bad.ts", "\uFEFFconst a = 1; \r\n").length >= 3);
  assert.ok(textErrors("bad.md", "说明").length);
});

test("YAML parser rejects duplicate keys rather than silently overriding rules", () => {
  assert.throws(() => parseYaml("on: {}\non: {push: null}\n"));
  assert.ok(parseYaml("on:\n  workflow_dispatch:\n").on);
});

test("license checks preserve upstream text and detect stale or swapped distribution notices", () => {
  const project = "RadishInk Source-Available License\nNew terms\n";
  const original = "MIT License\nOriginal attribution and terms\n";
  const contract = {
    project,
    original,
    upstream: original,
    distributedProject: project,
    distributedUpstream: original,
  };
  assert.deepEqual(licenseErrors(contract), []);
  for (const mutation of [
    { upstream: project },
    { upstream: "" },
    { upstream: original.replace("attribution", "replacement") },
    { distributedUpstream: project },
    { distributedProject: original },
    { project: original, distributedProject: original },
  ])
    assert.ok(licenseErrors({ ...contract, ...mutation }).length > 0);
});
