# 2026-11-09 Nginx 供应商源码复核

在本地 `dev` 提交上一批材料 `5fbc8a6` 后，按 Web 镜像的安装库复核 Nginx 供应商的 6 个包。两架构安装版本一致。固定 `pkg-oss` 标签 `1.30.6-1` 对应提交 `3e9e3b9f85308c0bb7b1cf849c87d1f7df98dfc3`，保留原配方、补丁、APKBUILD 模板及版权文件。两种架构各 6 个安装版权摘要与配方中的 `docs/*.copyright` 全部相符。[源码清单](2026-11-09-nginx-vendor-source-provision.json) · [固定 pkg-oss 配方](https://github.com/nginx/pkg-oss/tree/3e9e3b9f85308c0bb7b1cf849c87d1f7df98dfc3)

| 安装包                                                                          | 对应源码和构建输入                                                                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx`、`nginx-module-geoip`、`nginx-module-image-filter`、`nginx-module-xslt` | 使用 Nginx 1.30.6 原件。三个动态模块源码位于 Nginx 源码树，系统库的源码归入相应 aports 项。                                                                           |
| `nginx-module-njs`                                                              | 使用 njs 1.0.2 和固定提交 `fa628f8c523ecac8ce560c081411e91fcaba2d20` 的 QuickJS。配方应用 `quickjs.makefile.patch` 并构建静态 `libquickjs.a`，供动态模块和 CLI 构建。 |
| `nginx-module-acme`                                                             | 使用 ACME 0.4.1、锁定的 Rust 源码和 Nginx 配置生成输入。Cargo 锁文件与 ACME 发布归档和固定上游提交中的原件逐字节一致。                                                |

4 个上游源码归档通过固定 `pkg-oss` 的 SHA-512 核验。Nginx 与 ACME 原始签名单列保留。去重后新增 84 个固定文件、13,007,926 字节，缓存位于 `output/distribution/base/sources/nginx-vendor/`。[Nginx 源码](https://nginx.org/download/nginx-1.30.6.tar.gz) · [njs 原件](https://github.com/nginx/njs/releases/tag/1.0.2) · [ACME 原件](https://github.com/nginx/nginx-acme/releases/tag/v0.4.1)

## ACME 锁定依赖

按原始 `Cargo.lock` 核对全部 76 个 crates.io 原件的名称、版本及 SHA-256。11 个已缓存的相同字节直接复用。保留各 crate 原件及已有通知。`http-serde` 2.1.1 的发布原件与固定上游树均通过 `Cargo.toml` 声明 `Apache-2.0 OR MIT`，原件保留作者信息。本批选择其中的 Apache-2.0 选项，配套使用仓库已有的 Apache-2.0 全文。[http-serde 固定声明](https://gitlab.com/kornelski/http-serde/-/blob/c2403fb3d64bc0db31a05ca5d340ff82686163b1/Cargo.toml) · [Apache-2.0 全文](../../LICENSES/distribution/standard/Apache-2.0.txt)

重建时，按锁文件校验每个 `.crate`，保留 `<name>-<version>/` 目录解包到 `nginx-acme-0.4.1-vendor/`。每个 crate 目录的 `.cargo-checksum.json` 用 `package` 保存原件 SHA-256，用 `files` 保存各解包文件的相对路径及 SHA-256。以该目录为顶层打包 `nginx-acme-0.4.1-vendor.tar.gz`，与其他原件一起放到 `pkg-oss/contrib/tarballs/`。供应商配方会把 Cargo 源替换为这一目录。已按这些步骤从缓存生成本地派生产物，位于忽略的 `output/distribution/base/research/nginx-vendor/generated/`，SHA-256 为 `d35abffbec32d6e65aef73dc5696404d51f0eb5f25e9f2317ac45d168cf82677`。[Cargo vendor 文档](https://doc.rust-lang.org/cargo/commands/cargo-vendor.html)

## 验证与接续

- 使用独立空 `CARGO_HOME` 和本地 source replacement 运行 `cargo metadata --offline --locked --format-version 1`，解析结果与锁文件的 77 个包身份一致，锁文件字节保持一致。移除临时 vendor 中的 `base64` 后，离线解析因缺包而失败。
- 合并四批清单运行 `sourceCoverage` 和 `mise exec -- pnpm prepare:source-bundle`，逐项校验 120 项实际输入。门禁报告尚缺 8 项，目录与完整归档均未生成。临时缓存缺少已声明的 `base64` 原始 crate 时也会失败。
- `mise exec -- pnpm test:governance` 通过 133 项测试，仓库检查和 `git diff --check` 通过。本轮完成材料与离线解析验证，签名信任链和实际 APK 重建待验证。
- 下一批处理 Node、npm、Corepack、Yarn 与两类容器启动配方。另有 `alpine-base` 和 `alpine-keys` 的 MIT 通知待确认。
