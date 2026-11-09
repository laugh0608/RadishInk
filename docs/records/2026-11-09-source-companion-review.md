# 2026-11-09 基础源码伴随包本地验收

## Alpine 组合通知

将 `alpine-base@3.24.3-r0` 和 `alpine-keys@2.6-r0` 保留在 128 项计划中。以先前复核的已签名 APK、固定 APKBUILD 和公钥为版本与内容证据。随包保留各自改用 MIT 时的上游 APKBUILD 原件，包含公开的署名字段和 MIT 声明，并附上 SPDX v3.27.0 的 MIT 标准全文。原件中的署名按原义保留，标准文本的占位符保持原样。组合通知沿用项目已有的处理方式。[APK 与 Git 历史证据](2026-11-09-alpine-mit-review.md) · [项目既有做法](../deployment/image-distribution.md#范围与输入) · [SPDX 固定正文](https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MIT.txt)

原始 APKBUILD 和公钥继续单独按固定 SHA-256 校验，公钥另外匹配配方的 SHA-512。采用同一份 SPDX 原件，SHA-256 为 `b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5`。五批已复核清单原样合并，加入上述两项后形成全量 `base-provision.json`。[全量清单](../../LICENSES/distribution/base-provision.json)

## 归档与核验

以真实缓存和现有 391 个 native 原件离线运行 `mise exec -- pnpm prepare:source-bundle`，生成目录及 `output/distribution/radishink-sources-local-review-20261109.tar.gz`。生成器的目录与流式归档校验通过。再次运行 `prepare:source-bundle --check` 和 `verifySourceArchive` 复验，标准 `tar -tzf` 可读取全部 3,592 个成员。

- 基础源码覆盖 128 项、2,796 个去重原件，另含 391 个 native 原件与许可材料。
- `bundle.json` SHA-256 为 `5875386e95e02119bb5bfbd521d71600d94e49f90cca73998ce9252b8f6d05be`。
- `.tar.gz` 大小为 1,395,886,527 字节，SHA-256 为 `74253c7d764dfb6dc434f975d423ddd724936ae29e74dfbaaa011ac81e0e1c02`。

门禁负向复查分别从临时清单移除两项 Alpine 条目、移除 `alpine-base` 的通知、移除 `alpine-keys` 的一个公钥，原有工具均拒绝输入。两种架构的四个现有最终镜像通过 `check:base-image-plan` 与 `check:image-distribution`，其中 amd64 在本机模拟执行。133 项治理测试、仓库检查和格式检查通过。

本地验收完成后，按发布候选提交取得原生 CI，复核分发材料，继续核验远端标签保护及成对发布条件。归档留在本地忽略目录，供后续候选复核。[发布顺序](../governance/versioning.md#首次发布前的准备)
