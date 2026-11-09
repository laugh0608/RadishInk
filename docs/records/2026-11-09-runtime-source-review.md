# 2026-11-09 Node 工具链与容器启动配方复核

按四个本地最终镜像和固定基础镜像清单复核 6 项运行时材料。新增清单固定 2,181 个去重文件，共 641,158,544 字节。原件放在忽略的 `output/distribution/base/sources/runtime/`。两种 Server 架构的 Node、npm、Corepack、Yarn 版本和四份原始许可摘要一致，两类启动配方保留的六个脚本均与对应镜像匹配。[运行时清单](2026-11-09-runtime-source-provision.json) · [镜像清单](../../LICENSES/distribution/base-image-plan.json)

## 工具链材料

| 安装版本          | 对应源码与核验                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node `v22.23.4`   | 完整发布归档通过官方 SHA-256 清单校验，保留签名原件。归档含 V8、libuv、OpenSSL、ICU、llhttp、nghttp2、zlib 和随附工具。归档内和固定 Git 提交的 `LICENSE` 均匹配镜像原件。                                                                  |
| npm `10.9.9`      | 两种架构的 1,964 个安装文件条目逐一匹配 Node 发布归档中的 `deps/npm`，包含 Node 随附的生产依赖。Registry 发布件另作对照，部分文件与镜像有差异。独立源码和锁文件使用 Registry 标注的 `gitHead` `745d8d90b5403110d26ba332ba83d8c5a51f0578`。 |
| Corepack `0.36.0` | Registry 发布归档的 54 个文件与两架构安装副本全部匹配。保留固定 Git 源码、Yarn 锁文件和补丁。Yarn `4.18.0` 引导文件的 SHA-224 与源码中 `packageManager` 一致。                                                                             |
| Yarn `1.22.22`    | 发布归档及签名原件随包保留，归档中的 11 个文件与两架构安装副本全部匹配。源码归档的 5,577 个路径、模式和 Git blob 与固定提交吻合，另保留 Yarn Classic `1.22.17` 构建引导包。                                                                |

[Node 发布摘要](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt) · [npm 发布源码](https://github.com/npm/cli/tree/745d8d90b5403110d26ba332ba83d8c5a51f0578) · [Corepack 发布](https://github.com/nodejs/corepack/releases/tag/v0.36.0) · [Yarn 发布](https://github.com/yarnpkg/yarn/releases/tag/v1.22.22)

按三个上游锁文件收齐 npm 的 956 个、Corepack 的 350 个、Yarn Classic 的 1,061 个 Registry 原件。共享文件按相同字节合并，去重共 2,153 个、364,247,551 字节。npm 与 Yarn Classic 按原锁文件的 integrity 校验，带 SHA-1 的 Yarn Classic URL 同时核对其 SHA-1。Corepack 按锁定的包名、版本及 Registry 发布的原始包 integrity 校验，锁文件中四个补丁变体的基础包都已保留。Yarn 归一化缓存的 checksum 留待实际构建复核。

Yarn 源码归档首次传输超过 300 秒，服务端拒绝续传。延长时限重新完整下载后通过 gzip 和 Git 树核验，归档大小为 74,422,309 字节。恢复缓存时可以先下载大归档并按清单核对 SHA-256 和大小，再由伴随包工具检查缓存。[固定 Yarn 源码](https://github.com/yarnpkg/yarn/tree/740c38c3a962c30ddb344a919bbfb7065620714b)

## 容器启动配方

- **Docker Node** 两架构固定 OCI 证明均指向 `80f02a542da739e6a662451d1db66456a0dea253` 的 `22/bookworm-slim`。保留完整配方和许可，单列 `docker-entrypoint.sh`，与两架构 Server 镜像字节相同。[固定配方](https://github.com/nodejs/docker-node/tree/80f02a542da739e6a662451d1db66456a0dea253/22/bookworm-slim)
- **Docker Nginx** 两架构固定 OCI 证明均指向 `4b9f658be76820b24e4ef4605413a5c08707a512` 的 `stable/alpine`。保留其配方和许可，以及同提交的 `stable/alpine-slim` 基础层配方。入口脚本和四个钩子与两架构 Web 镜像字节相同。[固定配方](https://github.com/nginx/docker-nginx/tree/4b9f658be76820b24e4ef4605413a5c08707a512/stable/alpine) · [基础层配方](https://github.com/nginx/docker-nginx/tree/4b9f658be76820b24e4ef4605413a5c08707a512/stable/alpine-slim)

## 验证与接续

- 对两种架构分别运行 `mise exec -- pnpm check:base-image-plan --server <本地 Server 镜像> --web <本地 Web 镜像>`。四个 `radishink-p4-materials-*:20261103` 镜像均匹配固定清单。采集容器只读、无网络，amd64 在本机模拟执行。
- 合并五批清单后，`sourceCoverage` 和 `mise exec -- pnpm prepare:source-bundle` 校验了 126 项输入。将临时清单中的 Node 启动脚本摘要改坏会被拒绝。全量门禁报告仍缺 `alpine-base` 和 `alpine-keys`，目录与归档均未生成。
- `mise exec -- pnpm test:governance` 通过 133 项测试，仓库检查、格式检查和 `git diff --check` 通过。发布签名已保留，签名信任链和实际重建仍待验证。
- 接续核实两个 Alpine 项的 MIT 通知。材料齐备后再生成并验证完整伴随包。
