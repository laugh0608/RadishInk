# 参与 RadishInk

先读 [产品范围](docs/product-scope.md) 和 [当前状态](docs/status/current.md)。本项目从 WeMD 演进，当前关注纯前端写作、预览、本地草稿与公众号复制。

## 开发

使用 [mise 开发环境](docs/development/local-development.md) 安装项目 Node 22 / pnpm 9.0.2。依赖按锁文件安装，保留上游版权和资产来源。

维护者串行开发在 `dev`；外部贡献或需要隔离时从 `dev` 建主题分支，PR 目标为 `dev`。只有阶段性 `dev` 集成和紧急 `hotfix/*` 面向 `main`。合并方式及回流要求见 [ADR 0001](docs/adr/0001-branch-and-pr-governance.md)。

提交使用 Conventional Commits，例如 `fix(copy): 保留引用块中的公式`。不要机械改写上游历史、格式化全仓、添加无关依赖或混入生成物。

## 验证与 PR

按 [验证基线](docs/development/validation.md) 执行检查；准备稳定主线 PR 时运行：

```bash
mise exec -- pnpm validate:web
```

渲染、样式内联、公式 / Mermaid、公众号复制和本地存储变化要覆盖受影响行为；存储格式变化说明迁移。PR 记录已执行与未验证内容，更新正式文档，并明确外部请求、依赖、许可及回滚影响。

目前不要求贡献者自我审批或虚构 CODEOWNERS；真实评审意见需解决，所有必需检查须通过。管理员 bypass 不用于日常跳过失败。

遵守 [社区准则](CODE_OF_CONDUCT.md)，使用有权提交且已脱敏的材料。安全漏洞按 [SECURITY.md](SECURITY.md) 私下报告。
