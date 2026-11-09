# GitHub 设置与 Rulesets

这里保存 RadishInk 的目标配置。`main-protection.json` 已于 2026-10-05 通过 `gh api` 应用为远程 [Ruleset 24501729](https://github.com/laugh0608/RadishInk/rules/24501729)，状态为 `active`；配置回读、缺少必需检查和真实组件失败的合并阻断已核对。会话解决与管理员 bypass 未做行为测试，详见 [PR CI 验证记录](../../docs/records/2026-10-05-pr-ci-validation.md)。

- `main-protection.json`：只保护 `main` 的 branch Ruleset。
- [创建规则](release-tag-creation.json)与[保护规则](release-tag-protection.json)：发布 tag 的目标配置，远端启用状态见[当前状态](../../docs/status/current.md)。
- `../repository-settings.json`：默认分支与合并选项目标，需单独配置，不属于 Ruleset 内容；本次未应用该模板。

## 策略

`main` 要求 PR、会话全部解决、分支与目标最新同步，以及 `Candidate Quality` 成功；禁止删除与 force push。单人阶段审批数为 0，不要求 CODEOWNERS 或签名。管理员角色（RepositoryRole 5）仅允许 PR 内 bypass，使用时记录原因与补验。

允许 merge / rebase，禁用 squash；不要求线性历史。`dev` 暂不启用 Ruleset，普通 push 不触发 CI。规则不会自动创建分支，也不会自动运行检查。

分支规则匹配 `refs/heads/main`，required context 为 `Candidate Quality`。

`Server Quality` 的 Linux amd64 / arm64 矩阵沿用同一个 required context。实际远端运行见[当前状态](../../docs/status/current.md)。下面的首次初始化步骤保留当时的组件范围。

## 发布 tag 规则

两份规则匹配同一批 `dev`、`test`、`release` 轨道 tag，覆盖带日期扩展的版本和现有两个源码预发布 tag。GitHub `fnmatch` 用于圈定保护范围，完整版本语法继续由 `check:release-tag` 校验。[版本规则](../../docs/governance/versioning.md#产品版本与-git-tag) · [GitHub 匹配规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#using-fnmatch-syntax)

创建限制只允许仓库管理员绕过。更新、删除限制无 bypass。分开保存使管理员的创建权限无法绕过另一份规则。仓库检查核对匹配范围、规则和 bypass。[GitHub Ruleset API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)

启用和验收按以下顺序进行。

1. 获得远端设置授权后重新读回现有规则与 tag。先应用保护规则，再应用创建规则。对每份规则保存 ID、回读目标和 bypass，并核对已有 tag 的引用与对象 SHA。再次执行时按既有 ID 更新。
2. 将配置回读与实际写入行为分别记录。若要补做写入测试，先审阅专用测试 tag、身份和清理方式。测试覆盖普通写入者创建、管理员首次创建，以及改指和删除的拒绝结果。
3. 镜像仓库的完整标签与写入隔离单独验收。[镜像发布保护](../../docs/deployment/release-materials.md#远端写入验收)

## 首次启用顺序

以下为首次启用流程；每项外部操作需对应授权。分支初始化、PR #1 合并、规则启用及 PR #2 自动检查 / 失败阻断验证已执行。原始配置见 [远程配置记录](../../docs/records/2026-10-05-remote-pr-initialization.md)，后续结果见 [PR CI 验证记录](../../docs/records/2026-10-05-pr-ci-validation.md)，不要重复引导已有分支或创建重复规则。

1. 本地完成初始化和验证，审阅提交；确认目标为 `laugh0608/RadishInk`、远程仍为空。
2. 首次建分支使用已停用旧发布工作流的治理基线 `46cf893` 建立远程 `main`，使用审阅并验证后的本地 `dev` 建立远程 `dev`；之后通过 `dev -> main` PR 合入产品改动。首次建分支是空仓库引导，后续 `main` 仍必须走 PR。执行前重新确认远程为空、基线是 `dev` 的祖先，可用明确 refspec `git push --no-follow-tags origin 46cf893:refs/heads/main dev:refs/heads/dev`，不使用 force、`--all`、`--tags` 或 `--mirror`。**不能将上游导入基线直接作为首次 main 推送**：导入提交 `70835e1` 含有效的上游 Docker 发布流程。远程 `main` 建立后更新本地跟踪关系并快进本地分支；不要重置或改写历史。
3. 保持 `main` 为默认分支，核对 Merge options；禁用自动删除 head 分支，避免长期 `dev` 被删除。
4. 检查账号套餐、仓库可见性及现有 Rulesets。公开仓库可在 Free 使用 branch Rulesets，私有仓库需要支持的 Pro / Team / Enterprise 计划；不支持时如实记录，不能宣称模板已实现保护。[GitHub 官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
5. 创建 `dev -> main` PR，确认 `PR Checks` 的两个组件和 `Candidate Quality` 都真实产生；需要单独诊断时可手动运行。`push` 本身不会触发当前 CI。启用规则、完成阻断验证并合入已验证的 PR 后，才把 `main` 用作部署来源。
6. 保存当前远程设置与 Ruleset JSON，再通过 Settings 导入模板或 `gh api` 提交审阅后的 JSON；创建使用 `POST repos/OWNER/REPO/rulesets --input FILE`，已有同范围规则时使用 `PUT repos/OWNER/REPO/rulesets/RULESET_ID --input FILE` 更新原 ID，不重复叠加。REST 参数见 [官方说明](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)。
7. 核对 `Candidate Quality` 来源为 GitHub Actions；必要时在远程选择实际集成来源。模板不硬编码环境相关的 App ID。
8. 在临时 PR 中制造一个无害检查失败，确认聚合和合并按钮都阻断，再修复；检查会话解决与管理员 PR-only bypass。读取分支规则确认删除和 force push 限制，不对真实 `main` 执行破坏性测试。
9. 把实际规则 ID、配置回读、行为验证结果和差异记录到正式文档；分别标明“远程已启用”和“阻断验收通过”，不能以创建 API 成功代替行为验收。

## 日常维护与回退

Ruleset 修改前先读取实际状态。CI check 改名时先让新 context 真实运行，再切换 required checks，避免无可用检查的窗口。恢复旧配置使用此前导出的准确 ID 和内容，不为排障开放永久直接 push。

仓库设置模板不会修改仓库公开 / 私有属性，也不会连接 Vercel、开启 Actions 发布或创建 Release。是否执行这些动作按各自任务范围决定。
