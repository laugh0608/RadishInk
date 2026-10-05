# 暂停的上游工作流

此目录不是 GitHub Actions 的工作流发现目录。保留原文件用于审阅来源，当前不会因 push、tag 或 workflow_dispatch 执行。

- `docker-image.yml`：原 WeMD GHCR 镜像发布，目标仍是上游命名空间。
- `release.yml`：原 WeMD 桌面端打包和 Release 发布。

恢复必须作为独立变更：先修改品牌、发布目标、版本、凭据与验证，再移动回 `.github/workflows/`。不要直接复制回来。本轮只允许 `.github/workflows/ci.yml` 作为活动工作流，检查器会检测意外恢复。
