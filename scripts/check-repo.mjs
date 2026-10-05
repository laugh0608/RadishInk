import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseDocument } from "yaml";

export const IMPORT_COMMIT = "70835e141aa94c0296c78c0f6adf67f636475f38";
export const AGGREGATE_GUARD =
  '[[ "${REPO_RESULT}" == "success" && "${WEB_RESULT}" == "success" ]]';
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const list = (output) => output.split("\0").filter(Boolean);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function parseYaml(text) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors[0].message);
  return document.toJS();
}

export function checkPrRoute(base, head) {
  if (!["main", "dev"].includes(base)) return "PR 目标必须是 main 或 dev";
  if (base === "main" && head !== "dev" && !/^hotfix\/.+/.test(head)) {
    return "面向 main 的 PR 必须来自 dev 或 hotfix/*";
  }
  return null;
}

export function validCommitSubject(subject, parentCount = 1) {
  // Exempt actual merge commits, not a one-parent commit merely named 'Merge ...'.
  return (
    parentCount > 1 ||
    /^(feat|fix|docs|refactor|test|chore|ci|build|perf|revert)(\([a-z0-9._/-]+\))?!?: \S.+$/.test(
      subject,
    )
  );
}

export function textErrors(path, text) {
  const errors = [];
  if (text.startsWith("\uFEFF")) errors.push(`${path}: UTF-8 BOM`);
  if (!/\.(bat|cmd)$/i.test(path) && text.includes("\r"))
    errors.push(`${path}: 应使用 LF`);
  if (text && !text.endsWith("\n")) errors.push(`${path}: 缺少末尾换行`);
  text.split(/\r?\n/).forEach((line, index) => {
    const suffix = line.match(/[\t ]+$/)?.[0];
    if (suffix && !(path.endsWith(".md") && suffix === "  " && line.trim())) {
      errors.push(`${path}:${index + 1}: 尾随空白`);
    }
  });
  return errors;
}

export function governanceErrors({
  workflow,
  ruleset,
  settings,
  pkg,
  mise,
  vercel,
  activeWorkflows,
}) {
  const errors = [];
  const expect = (condition, message) => {
    if (!condition) errors.push(message);
  };
  expect(
    same(activeWorkflows, ["ci.yml"]),
    "只能启用 ci.yml；发布恢复需要同步治理策略",
  );
  expect(
    same(Object.keys(workflow.on ?? {}).sort(), [
      "pull_request",
      "workflow_dispatch",
    ]),
    "CI 只能由 PR 或手动触发",
  );
  expect(
    same(workflow.on?.pull_request, { branches: ["main", "dev"] }),
    "PR 必须覆盖 main/dev 且无路径过滤",
  );
  expect(
    same(workflow.permissions, { contents: "read" }),
    "CI 必须只读仓库权限",
  );
  expect(
    workflow.concurrency?.["cancel-in-progress"] === true,
    "CI 必须取消过期运行",
  );
  const jobs = workflow.jobs ?? {};
  expect(
    same(Object.keys(jobs).sort(), [
      "candidate-quality",
      "repo-hygiene",
      "web-quality",
    ]),
    "CI 组件必须与聚合契约一致",
  );
  const candidate = jobs["candidate-quality"] ?? {};
  expect(
    candidate.name === "Candidate Quality",
    "聚合 context 必须为 Candidate Quality",
  );
  expect(
    same(candidate.needs, ["repo-hygiene", "web-quality"]),
    "聚合必须等待仓库与 Web 组件",
  );
  expect(candidate.if === "always()", "聚合必须 always() 执行");
  expect(candidate.steps?.length === 1, "聚合须只有一个最终判定步骤");
  const aggregate = candidate.steps?.[0] ?? {};
  expect(aggregate.shell === "bash", "聚合使用 bash");
  expect(
    same(aggregate.env, {
      REPO_RESULT: "${{ needs.repo-hygiene.result }}",
      WEB_RESULT: "${{ needs.web-quality.result }}",
    }),
    "聚合必须读取真实组件结果",
  );
  expect(
    aggregate.run?.trimEnd().endsWith(AGGREGATE_GUARD),
    "聚合最后一行必须严格判定所有组件 success",
  );
  for (const [id, job] of Object.entries(jobs)) {
    expect(
      !job["continue-on-error"] && !job.permissions,
      `${id}: 不得忽略失败或扩大权限`,
    );
    expect(Number.isFinite(job["timeout-minutes"]), `${id}: 缺少超时`);
    if (id !== "candidate-quality")
      expect(job.if === undefined, `${id}: 组件不得条件跳过`);
    for (const step of job.steps ?? []) {
      expect(
        !step["continue-on-error"] && step.if === undefined,
        `${id}: 步骤不得跳过或忽略失败`,
      );
    }
  }
  const requiredRuns = {
    "repo-hygiene": ["pnpm install --frozen-lockfile", "pnpm test:governance"],
    "web-quality": [
      "pnpm install --frozen-lockfile",
      "pnpm lint:web",
      "pnpm test:web",
      "pnpm build:web",
    ],
  };
  for (const [id, commands] of Object.entries(requiredRuns)) {
    const steps = jobs[id]?.steps ?? [];
    for (const command of commands)
      expect(
        steps.some((step) => step.run === command),
        `${id}: 缺少 ${command}`,
      );
    expect(
      steps.some(
        (step) =>
          step.uses?.startsWith("actions/setup-node@") &&
          step.with?.["node-version"] === "22",
      ),
      `${id}: 必须使用 Node 22`,
    );
    expect(
      steps.some(
        (step) =>
          step.uses?.startsWith("pnpm/action-setup@") &&
          step.with?.version === undefined,
      ),
      `${id}: pnpm 必须沿用 packageManager`,
    );
  }
  const repoSteps = jobs["repo-hygiene"]?.steps ?? [];
  const range = repoSteps.find(
    (step) => step.name === "Check repository and PR range",
  );
  expect(
    range?.env?.BASE_SHA === "${{ github.event.pull_request.base.sha }}" &&
      range?.env?.HEAD_SHA === "${{ github.event.pull_request.head.sha }}",
    "提交范围须来自 PR base/head SHA",
  );
  expect(
    range?.run?.includes(
      'pnpm check:repo --base-ref "${BASE_SHA}" --head-ref "${HEAD_SHA}" --base-branch "${BASE_BRANCH}" --head-branch "${HEAD_BRANCH}"',
    ),
    "PR 必须执行范围与路由检查",
  );
  expect(
    repoSteps.some(
      (step) =>
        step.uses?.startsWith("actions/checkout@") &&
        step.with?.["fetch-depth"] === 0,
    ),
    "提交检查需要完整历史",
  );

  expect(
    ruleset.target === "branch" && ruleset.enforcement === "active",
    "Ruleset 应为可启用的 branch 模板",
  );
  expect(
    same(ruleset.conditions?.ref_name, {
      include: ["refs/heads/main"],
      exclude: [],
    }),
    "Ruleset 只能保护 main",
  );
  expect(
    same(ruleset.bypass_actors, [
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ]),
    "管理员仅可 PR 内 bypass",
  );
  const rules = new Map((ruleset.rules ?? []).map((rule) => [rule.type, rule]));
  expect(
    same([...rules.keys()].sort(), [
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]),
    "Ruleset 规则集合不符合当前策略",
  );
  expect(
    (ruleset.rules ?? []).length === rules.size,
    "Ruleset 不得出现重复规则",
  );
  expect(
    same(rules.get("pull_request")?.parameters, {
      allowed_merge_methods: ["merge", "rebase"],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_approving_review_count: 0,
      required_review_thread_resolution: true,
    }),
    "PR 合并方法、审批或会话解决策略漂移",
  );
  expect(
    same(rules.get("required_status_checks")?.parameters, {
      do_not_enforce_on_create: true,
      required_status_checks: [{ context: "Candidate Quality" }],
      strict_required_status_checks_policy: true,
    }),
    "required check 必须严格绑定 Candidate Quality",
  );
  expect(
    same(settings, {
      default_branch: "main",
      allow_merge_commit: true,
      allow_rebase_merge: true,
      allow_squash_merge: false,
      allow_auto_merge: false,
      delete_branch_on_merge: false,
    }),
    "仓库合并设置漂移或可能自动删除 dev",
  );
  expect(
    pkg.packageManager === "pnpm@9.0.2" &&
      same(pkg.engines, { node: "22.x", pnpm: "9.0.2" }),
    "package 工具版本不一致",
  );
  expect(
    /^node = "22"$/m.test(mise) && /^pnpm = "9\.0\.2"$/m.test(mise),
    "mise 工具版本不一致",
  );
  const scripts = {
    "check:repo": "node scripts/check-repo.mjs",
    "test:governance": "node --test scripts/check-repo.test.mjs",
    "lint:web": "pnpm --filter @wemd/web run lint",
    "test:web": "pnpm --filter @wemd/core --filter @wemd/web run test:ci",
    "build:web": "pnpm --filter @wemd/web run build",
    "validate:web":
      "pnpm check:repo && pnpm test:governance && pnpm lint:web && pnpm test:web && pnpm build:web",
  };
  for (const [name, command] of Object.entries(scripts))
    expect(pkg.scripts?.[name] === command, `${name}: 检查入口漂移`);
  expect(
    vercel.framework === "vite" &&
      vercel.installCommand === "pnpm install --frozen-lockfile" &&
      vercel.buildCommand === "pnpm build:web" &&
      vercel.outputDirectory === "apps/web/dist",
    "Vercel 必须只构建 Web",
  );
  return errors;
}

export function loadGovernance() {
  return {
    workflow: parseYaml(read(".github/workflows/ci.yml")),
    ruleset: JSON.parse(read(".github/rulesets/main-protection.json")),
    settings: JSON.parse(read(".github/repository-settings.json")),
    pkg: JSON.parse(read("package.json")),
    mise: read("mise.toml"),
    vercel: JSON.parse(read("vercel.json")),
    activeWorkflows: readdirSync(resolve(root, ".github/workflows"))
      .filter((name) => /\.ya?ml$/.test(name))
      .sort(),
  };
}

function checkLinks(path, text, errors) {
  // Check repository-relative inline links, ignoring code examples and URL fragments.
  const prose = text.replace(/```[^]*?```/g, "");
  for (const match of prose.matchAll(
    /\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
    const location = decodeURIComponent(target.split(/[?#]/)[0]);
    if (location && !existsSync(resolve(root, dirname(path), location)))
      errors.push(`${path}: 链接不存在 ${target}`);
  }
}

function main() {
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        "base-ref",
        "head-ref",
        "base-branch",
        "head-branch",
        "upstream-ref",
      ].map((key) => [key, { type: "string" }]),
    ),
  });
  const sha = (ref) =>
    git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  if (Boolean(values["base-ref"]) !== Boolean(values["head-ref"]))
    throw new Error("base-ref 与 head-ref 必须同时提供");
  if (Boolean(values["base-branch"]) !== Boolean(values["head-branch"]))
    throw new Error("base-branch 与 head-branch 必须同时提供");
  const errors = [];
  const required = [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "LICENSE",
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    "mise.toml",
    "vercel.json",
    "pnpm-lock.yaml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/rulesets/README.md",
    ".github/repository-settings.json",
    ".github/workflows-disabled/docker-image.yml",
    ".github/workflows-disabled/release.yml",
    "docs/README.md",
    "docs/status/current.md",
    "docs/product-scope.md",
    "docs/governance/repository-governance.md",
    "docs/governance/agent-collaboration.md",
    "docs/governance/upstream.md",
    "docs/adr/0001-branch-and-pr-governance.md",
    "docs/development/local-development.md",
    "docs/development/validation.md",
    "docs/deployment/vercel.md",
    "scripts/check-repo.test.mjs",
  ];
  for (const path of required)
    if (!existsSync(resolve(root, path))) errors.push(`缺少 ${path}`);
  if (errors.length) throw new Error(errors.join("\n"));
  errors.push(...governanceErrors(loadGovernance()));
  if (
    read("AGENTS.md").split("\n").slice(1).join("\n") !==
    read("CLAUDE.md").split("\n").slice(1).join("\n")
  )
    errors.push("AGENTS / CLAUDE 正文未同步");
  if (read("LICENSE") !== git("show", `${IMPORT_COMMIT}:LICENSE`))
    errors.push("原始 WeMD LICENSE 发生变化，需要单独审阅许可策略");
  const files = [
    ...new Set(
      list(git("ls-files", "--cached", "--others", "--exclude-standard", "-z")),
    ),
  ].filter((path) => existsSync(resolve(root, path)));
  for (const path of files) {
    if (
      /(^|\/)(node_modules|dist|coverage|\.vercel)\//.test(path) ||
      (/(^|\/)\.env(?:\.|$)/.test(path) && !/\.example$/.test(path))
    )
      errors.push(`不应跟踪本地或生成文件: ${path}`);
    if (
      path.endsWith(".md") &&
      (path.startsWith("docs/") ||
        !path.includes("/") ||
        path.startsWith(".github/"))
    )
      checkLinks(path, read(path), errors);
    if (/^\.github\/.*\.ya?ml$/.test(path)) parseYaml(read(path));
  }
  let changed;
  if (values["base-ref"]) {
    const base = sha(values["base-ref"]),
      head = sha(values["head-ref"]);
    changed = list(
      git(
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        "-z",
        `${base}...${head}`,
      ),
    );
    const imported = new Set(
      git("rev-list", sha(IMPORT_COMMIT)).trim().split("\n"),
    );
    if (values["upstream-ref"]) {
      const upstream = sha(values["upstream-ref"]);
      git("merge-base", "--is-ancestor", upstream, head);
      for (const commit of git("rev-list", upstream).trim().split("\n"))
        imported.add(commit);
    }
    for (const commit of git("rev-list", `${base}..${head}`)
      .trim()
      .split("\n")
      .filter(Boolean)) {
      if (imported.has(commit)) continue;
      const [parents, subject] = git("show", "-s", "--format=%P%n%s", commit)
        .trimEnd()
        .split("\n");
      if (!validCommitSubject(subject, parents ? parents.split(" ").length : 0))
        errors.push(
          `${commit.slice(0, 8)}: 提交标题不符合 Conventional Commits`,
        );
    }
  } else {
    if (values["upstream-ref"])
      throw new Error("upstream-ref 仅用于显式 PR 提交范围");
    changed = [
      ...list(git("diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD")),
      ...list(git("ls-files", "--others", "--exclude-standard", "-z")),
    ];
  }
  if (values["base-branch"]) {
    const error = checkPrRoute(values["base-branch"], values["head-branch"]);
    if (error) errors.push(error);
  }
  const textExtensions = new Set([
    ".md",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".css",
    ".html",
    ".sh",
    ".svg",
    ".txt",
  ]);
  for (const path of new Set(changed)) {
    if (
      !existsSync(resolve(root, path)) ||
      !statSync(resolve(root, path)).isFile()
    )
      continue;
    if (
      !textExtensions.has(extname(path)) &&
      ![
        ".gitignore",
        ".gitattributes",
        ".editorconfig",
        ".husky/pre-commit",
      ].includes(path)
    )
      continue;
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(readFileSync(resolve(root, path)));
    errors.push(...textErrors(path, text));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Repository checks passed (${new Set(changed).size} changed files; governance, links and provenance verified).`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
