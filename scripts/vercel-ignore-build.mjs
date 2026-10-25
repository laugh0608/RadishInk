import { spawnSync } from "node:child_process";

// Vercel Ignored Build Step: 0 跳过，1 继续构建；不能用作 CI 检查。
function finish(skip, reason) {
  console.log(
    `[vercel-ignore-build] ${skip ? "跳过构建" : "继续构建"}：${reason}`,
  );
  process.exit(skip ? 0 : 1);
}

if (process.env.VERCEL_GIT_COMMIT_REF !== "dev") {
  finish(false, "仅对 dev 启用内容去重");
}

const previous = process.env.VERCEL_GIT_PREVIOUS_SHA ?? "";
if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(previous)) {
  finish(false, "缺少有效的上次成功部署 SHA（首次部署等情况）");
}

const trees = [];
for (const revision of [`${previous}^{tree}`, "HEAD^{tree}"]) {
  const result = spawnSync("git", ["rev-parse", "--verify", revision], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    finish(false, "无法读取 Git tree（历史缺失或 Git 错误），不跳过");
  }
  const tree = result.stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(tree)) {
    finish(false, "Git tree 输出无效，不跳过");
  }
  trees.push(tree);
}

finish(
  trees[0] === trees[1],
  trees[0] === trees[1]
    ? "与 dev 上次成功部署的全部跟踪文件一致"
    : "与 dev 上次成功部署存在文件变化",
);
