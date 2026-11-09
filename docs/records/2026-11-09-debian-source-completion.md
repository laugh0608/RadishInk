# 2026-11-09 Debian 基础源码剩余项复核

在 `dev` 提交首批记录 `707d27c` 后，继续复核已缓存的 56 项 Debian 源码。新增清单固定 182 个原始文件、259,307,849 字节及逐项重建入口。与首批合计覆盖计划中的全部 63 项 Debian 需求、203 个原始文件、262,775,648 字节。[新增清单](2026-11-09-debian-source-remaining-provision.json) · [首批记录](2026-11-09-debian-source-review.md)

## 特殊输入

逐项比对 `.dsc` 的源码包名、完整版本和 SHA-256 文件清单，读取原件中的版权通知、构建配方、补丁序列和随包构建输入。以下几项需要保留普通上游归档以外的内容。

| 源码包      | 复核结果                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcc-12`    | 读取外层原件里的 GCC DFSG、newlib、gm2 三份归档，确认运行库源码与构建输入随包保存。Debian 打包归档保留 `rules.unpack` 和按架构生成 quilt 序列的 `rules.patch`。 |
| `glibc`     | 归档保留通用及其他 OS 的补丁序列，共 132 项引用，均能找到原件。重建入口按 Debian 架构规则使用已固定的源码归档。                                                 |
| `db5.3`     | DFSG 原件保留嵌入的 SQLite 源码及 `lang/sql/generated/sqlite3.c`，使用 Debian SQL 构建选项。                                                                    |
| `perl`      | 主归档和 `orig-regen-configure.tar.xz` 都是 `.dsc` 声明的输入。后一归档保留 `metaconfig` 的 `U/` 和 `.package`，供 `update-configure` 使用。                    |
| `pcre2`     | 源码格式为 `1.0`。独立 `.diff.gz` 包含 `debian/rules` 和 `debian/copyright`，与上游原件一同保留。                                                               |
| `libxcrypt` | 按配方把 `debian/copyright.in` 和原件的 `LICENSING` 拼接，其 SHA-256 与两架构镜像安装的 `libcrypt1` 版权文件一致。                                              |

## 验证

- 从源码归档读取或按既有配方组合 Debian 版权文件，并与固定镜像清单的 `copyrightSha256` 比对。Server amd64 和 arm64 各 88 个安装包全部匹配。
- 合并两批清单后，现有 `sourceCoverage` 和 `mise exec -- pnpm prepare:source-bundle` 均逐项读取并校验 203 个实际原件，最终报告还缺 65 项其他基础来源。伴随包目录和归档均未生成。
- 分别从临时清单移除 Perl 的配置再生归档、PCRE2 的独立补丁，`sourceCoverage` 均以对应包的源码不完整拒绝输入。
- `mise exec -- pnpm test:governance` 通过 132 项测试。仓库检查、变更文件的 Prettier 检查和 `git diff --check` 均通过。
- 本轮读取归档和配方，并保留原始签名。签名信任链、实际重建和完整伴随包仍待验证。

余下 65 项由 53 个固定 aports 身份、6 个 Nginx 供应商包、Node 与 npm / Corepack / Yarn 及两类容器启动配方组成。后续先按固定提交复核 aports 的 APKBUILD、同目录文件和源码摘要，供应商包单列处理。[源码提供规则](../deployment/release-materials.md#收集与复核输入)
