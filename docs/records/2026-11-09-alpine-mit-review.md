# 2026-11-09 Alpine 两项 MIT 通知复核

剩余两项是 `alpine-base@3.24.3-r0` 和 `alpine-keys@2.6-r0`。实际 Web 镜像安装了由 `alpine-base` 生成的 `alpine-release` 子包。此次查证覆盖固定配方目录、同提交的 aports 根目录、两条目录历史及 Alpine v3.24 两种架构的官方 APK。[alpine-base 固定目录](https://github.com/alpinelinux/aports/tree/ee92350c8a4509152dc91c693814215a884c07c3/main/alpine-base) · [alpine-keys 固定目录](https://github.com/alpinelinux/aports/tree/b9f23becced4d7b3ccc0fa0f28530243ccd314a0/main/alpine-keys)

## 官方包与源码比对

从官方镜像取得 `x86_64` 和 `aarch64` 各三份 APK。使用现有最终 Web 镜像中固定的 Alpine 公钥，在只读、无网络容器内运行 `apk verify`，六份签名全部通过。两个实际安装包的版本、origin、commit、许可声明和 APK 控制段摘要均与各架构的安装库匹配。[x86_64 官方包目录](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/) · [aarch64 官方包目录](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/)

| 包               | 两架构实际检查结果                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `alpine-base`    | 无文件载荷的元包，`.PKGINFO` 声明 MIT。                                                                           |
| `alpine-release` | 载荷仅含五个发行信息路径，含一个符号链接，`.PKGINFO` 声明 MIT。                                                   |
| `alpine-keys`    | 两架构各自携带的 18 个公钥均匹配固定 APKBUILD 的 SHA-512，另有架构目录链接及各自的激活公钥，`.PKGINFO` 声明 MIT。 |

六份 APK 的控制段和载荷均未发现版权或许可通知。对应提交下，`main/alpine-base` 仅含 APKBUILD，`main/alpine-keys` 含 APKBUILD 和 18 个公钥。两个提交的 aports 根目录均无独立许可证文件。原始 APK、逐件 SHA-256 和检查摘要保留在忽略的 `output/distribution/base/research/aports/alpine-mit/`。

## 历史与剩余证据

查阅固定提交之前 `main/alpine-base` 的 308 条路径历史和 `main/alpine-keys` 的 18 条路径历史。`alpine-base` 在 3.4.0_rc1 提交中由 GPL 改为 MIT，`alpine-keys` 随后通过单独提交作出相同变更。两次变更均在 APKBUILD 中写入 MIT 标识，未附版权或许可通知。维护者字段按原件保留，版权归属需要独立的上游依据。[alpine-base 许可变更](https://github.com/alpinelinux/aports/commit/7938794a4d7e04420dc0d336e731b4bf0c4d1b61) · [alpine-keys 许可变更](https://github.com/alpinelinux/aports/commit/7f1f035cf4f7bbea5cf7b65f9bbedc311d735596)

这两项继续待复核。接续依据为 Alpine 上游针对这两项、或明确覆盖这两项的原始版权与 MIT 许可通知。已有签名、配方和公钥证据用于确认材料身份，完整通知仍是形成正式 `base-provision.json` 的前置条件。

## 本地验证

- 现有 126 项清单合并后运行 `mise exec -- pnpm prepare:source-bundle`，门禁报告缺少上述两项，未生成目录或完整归档。
- 对现有四个最终镜像分别按两种架构运行 `mise exec -- pnpm check:base-image-plan` 和 `mise exec -- pnpm check:image-distribution`。基础清单、镜像内通知与 Sharp、SQLite、Argon2 smoke 均通过，amd64 在本机模拟执行。
- `mise exec -- pnpm check:source-notices` 复验 760 个原始通知成员，通过。
- `mise exec -- pnpm test:governance` 通过 133 项测试，仓库检查、格式检查与 `git diff --check` 均通过。

后续依据项目既有的组合通知做法，使用本记录中的上游声明及 SPDX 固定条款完成本地伴随包验收。[后续验收](2026-11-09-source-companion-review.md)
