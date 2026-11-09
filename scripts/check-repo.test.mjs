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
    "publish workflow downloads the complete source companion again",
    (x) => {
      x.publication.jobs.publish.steps.unshift({
        run: "node scripts/distribution/source-bundle.mjs --fetch\n",
      });
    },
  ],
  [
    "containerd image store verification removed",
    (x) => {
      x.workflow.jobs["server-quality"].steps = x.workflow.jobs[
        "server-quality"
      ].steps.filter(
        (step) => !step.run?.includes("io.containerd.snapshotter.v1"),
      );
    },
  ],
  [
    "base source inventory gate removed",
    (x) => {
      x.workflow.jobs["server-quality"].steps = x.workflow.jobs[
        "server-quality"
      ].steps.filter(
        (step) => !step.run?.startsWith("pnpm check:base-image-plan"),
      );
    },
  ],
  [
    "source identities omitted from reviewed plan",
    (x) => {
      x.baseImagePlan.requirements.pop();
    },
  ],
  [
    "candidate build can write a full version tag",
    (x) => {
      x.publication.jobs.publish.steps.find(
        (step) => step.id === "web",
      ).with.tags = "radishink-web:v26.11.1-test";
    },
  ],
  [
    "publish workflow loses the conflict check",
    (x) => {
      const step = x.publication.jobs.publish.steps.find((entry) =>
        entry.run?.includes("--check-tags"),
      );
      step.run = step.run.replace(
        "release-pair.mjs --check-tags",
        "release-pair.mjs",
      );
    },
  ],
  [
    "pull deployment loses smoke",
    (x) => {
      x.workflow.jobs["server-quality"].steps = x.workflow.jobs[
        "server-quality"
      ].steps.filter((step) => !step.run?.startsWith("pnpm test:deployment"));
    },
  ],
  [
    "pull Compose silently builds",
    (x) => {
      x.releaseCompose.services.server.build = ".";
    },
  ],
  [
    "pull Compose uses a floating image",
    (x) => {
      x.releaseCompose.services.web.image =
        "ghcr.io/laugh0608/radishink-web:latest";
    },
  ],
  [
    "pull Compose creates an implicit empty volume",
    (x) => {
      delete x.releaseCompose.volumes.workspace.external;
    },
  ],
  [
    "missing image verification",
    (x) => {
      x.workflow.jobs["server-quality"].steps = x.workflow.jobs[
        "server-quality"
      ].steps.filter(
        (step) => !step.run?.startsWith("pnpm check:image-distribution"),
      );
    },
  ],
  [
    "missing source material build gate",
    (x) => {
      x.serverDockerfile = x.serverDockerfile.replace(
        "node scripts/distribution/image-notices.mjs --modules",
        "echo scripts/distribution/image-notices.mjs --modules",
      );
    },
  ],
  [
    "generated materials omitted from final image",
    (x) => {
      x.serverDockerfile = x.serverDockerfile.replace(
        "COPY --from=builder /runtime/distribution ./distribution\n",
        "",
      );
    },
  ],
  [
    "server metadata loses historical license scope",
    (x) => {
      x.serverPackage.license = "UNLICENSED";
    },
  ],
  [
    "Web base notices omitted",
    (x) => {
      x.webDockerfile = x.webDockerfile.replace(
        "RUN sh /tmp/capture-web-base-notices.sh",
        "RUN true #",
      );
    },
  ],
  [
    "server test bypasses build",
    (x) => {
      x.serverPackage.scripts["test:ci"] = "echo success";
    },
  ],
  [
    "missing server dependency",
    (x) => {
      x.workflow.jobs["candidate-quality"].needs = [
        "repo-hygiene",
        "web-quality",
      ];
    },
  ],
  [
    "missing server tests",
    (x) => {
      x.workflow.jobs["server-quality"].steps = x.workflow.jobs[
        "server-quality"
      ].steps.filter((step) => step.run !== "pnpm test:server");
    },
  ],
  [
    "missing server architecture",
    (x) => {
      x.workflow.jobs["server-quality"].strategy.matrix.os = ["ubuntu-24.04"];
    },
  ],
  [
    "server result replaced with success",
    (x) => {
      x.workflow.jobs["candidate-quality"].steps[0].env.SERVER_RESULT =
        "success";
    },
  ],
  [
    "unrelated dependency build disabled",
    (x) => {
      x.pkg.pnpm.neverBuiltDependencies.push("esbuild");
    },
  ],
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
    "release tag track excluded from protection",
    (x) => {
      x.tagProtectionRuleset.conditions.ref_name.include.pop();
    },
  ],
  [
    "tag creation bypass extends to moving or deleting tags",
    (x) => {
      x.tagProtectionRuleset.bypass_actors = x.tagCreationRuleset.bypass_actors;
    },
  ],
  [
    "release tag creation rule removed",
    (x) => {
      x.tagCreationRuleset.rules = [];
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
        for (const server of [
          "success",
          "failure",
          "cancelled",
          "skipped",
          "",
        ]) {
          const result = spawnSync(
            "bash",
            ["-e", "-o", "pipefail", "-c", step.run],
            {
              env: {
                ...process.env,
                REPO_RESULT: repo,
                WEB_RESULT: web,
                SERVER_RESULT: server,
                GITHUB_STEP_SUMMARY: join(directory, "summary"),
              },
            },
          );
          assert.ifError(result.error);
          assert.equal(
            result.status === 0,
            repo === "success" && web === "success" && server === "success",
            `${repo}/${web}/${server}`,
          );
        }
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
