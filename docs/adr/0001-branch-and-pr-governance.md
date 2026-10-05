# ADR 0001：分支与 PR 治理

日期：2026-10-05。状态：本地规则已采纳；远程启用另行验收。

## 背景与取舍

RadishInk 从 WeMD 导入，已有 `main` 和完整历史。当前由单人维护、前端优先，需要保留上游可追溯性，同时让稳定主线与连续开发分开。

参考了 Radish、RadishMind、RadishCatalyst、RadishFlow、RadishAxiom 的协作入口、分支 ADR、GitHub 模板和验证边界。采用其 `dev` 日常开发、稳定主线 PR、合并后回流和稳定聚合检查的原则；不引入 ASP.NET、Go、Rust、Godot 或模型训练等项目专属门禁。

## 决策

| 分支       | 用途                                   | 进入方式                              |
| ---------- | -------------------------------------- | ------------------------------------- |
| `main`     | 默认稳定主线，未来 Vercel 生产分支     | `dev` 阶段 PR；紧急 `hotfix/*` PR     |
| `dev`      | 串行日常开发与集成                     | 本地验证后的直接提交；必要时接主题 PR |
| 主题分支   | 外部贡献、并行写入、风险隔离或明确评审 | 通常面向 `dev`                        |
| `hotfix/*` | 从最新 `main` 创建的紧急稳定版修复     | 面向 `main`，合并后回流 `dev`         |

人工主题分支可用 `feature/`、`fix/`、`docs/`、`chore/`；Agent 创建的主题分支默认 `codex/`。没有隔离需求不自动创建额外分支或 worktree。

允许 merge commit 与 rebase merge，禁用 squash。`dev -> main` 优先 merge commit 保留开发历史和上游来源；rebase merge 会改变提交身份，需承担后续普通 merge 回流的成本。

## 回流

任何主线 PR 合并后，先停止下一轮 `dev` 提交并更新远程引用，在干净工作区执行：

```bash
git fetch origin
git switch dev
git merge --ff-only origin/main
git merge-base --is-ancestor origin/main dev
```

若无法快进，检查分叉原因，再用普通 `git merge origin/main` 解决冲突并验证。禁止用 rebase、reset 或 force push 伪造同步。回流后的推送须在已授权范围内进行；回流不自动创建标签或触发发布。

## 保护策略

只保护 `refs/heads/main`。要求 PR、解决会话、严格最新的 Candidate Quality，禁止删除与 force push；单人阶段 0 审批。管理员仅在 PR 内 bypass。仓库设置和 Ruleset 同时允许 merge / rebase，禁用 squash，不要求线性历史。

`dev` 暂不设强制 Ruleset，普通 push 不触发 CI；PR 面向 `main` / `dev` 和手动运行均检查。出现稳定多人维护、持续外部贡献或绕过检查造成实际回归时，重新评估 `dev` 保护与审批数。

Conventional Commits 放在提交范围检查器中，不用 Ruleset 正则阻止 GitHub 自动生成的 merge commit，也不追溯处罚上游历史。

## 首次初始化例外

空远程仓库无法先通过 PR 建立受保护主线。首次可在本地验证并取得推送授权后，把完成初始化的同一提交建立为远程 `main` 和 `dev`，再验证 CI 并启用保护。这是一次性引导，不是以后直接写 `main` 的例外。

本次任务只完成本地准备；不得因文档给出步骤而自动执行远程推送或设置修改。首次远程落地流程见 [Rulesets](../../.github/rulesets/README.md)。

## 后果

普通开发保持轻量；稳定主线拥有可复核检查和合并记录。代价是维护者须承担本地验证、合并后回流，以及模板与远程实际设置的同步。发布门禁与分支保护分开管理，检查通过不等于已部署。
