# 2026-11-09 aports 源码收集与复核

按固定 Web 镜像的 aports 提交收齐 53 项配方与同目录 266 个 Git 文件。每个文件按 Alpine 官方镜像的树条目核对 Git blob 和大小，并固定 SHA-256。逐项比对 APKBUILD 的版本、展开后的 `source`、安装脚本和触发器。常规 distfile 按 `sha512sums` 校验，包内原始通知随对应材料保留。原件缓存位于 `output/distribution/base/sources/aports/`，逐包元数据位于 `output/distribution/base/research/aports/`。[镜像计划](../../LICENSES/distribution/base-image-plan.json) · [Alpine 官方 aports 镜像](https://github.com/alpinelinux/aports)

新增清单纳入已完成复核的 51 项、305 个文件、267,629,607 字节。BusyBox 的架构配置和安装钩子、GCC 的引导和交叉构建补丁、FreeType 的 ft2demos、libavif 的独立 libargparse、libpng 的 APNG 补丁均随各自配方保留。对 `alpine-baselayout` 另收齐 Debian netbase 6.4 的原始源码包，确认其中 `protocols` 和 `services` 与 Alpine 构建输入逐字节相同，并保留其版权通知。[复核清单](2026-11-09-aports-source-provision.json) · [netbase 6.4 来源](https://snapshot.debian.org/package/netbase/6.4/)

`alpine-base` 和 `alpine-keys` 的固定配方均声明 MIT，原始目录没有独立版权通知或许可全文。已保留生成发行信息的元包配方，以及 `alpine-keys` 的 18 个公钥和 SHA-512 清单。这两项待确认适用的原始 MIT 通知后再入复核清单。[alpine-base 固定目录](https://github.com/alpinelinux/aports/tree/ee92350c8a4509152dc91c693814215a884c07c3/main/alpine-base) · [alpine-keys 固定目录](https://github.com/alpinelinux/aports/tree/b9f23becced4d7b3ccc0fa0f28530243ccd314a0/main/alpine-keys)

## libyuv 归档

Gitiles 和 Alpine 镜像的 gzip 字节均与 APKBUILD 中历史 `sha512sums` 条目不同。固定配方说明归档时间戳会变化，构建时改用 `_libyuvchecksum` 核对按路径排序的普通文件内容。v3.24 与 edge 镜像各自的 190 个文件均通过该校验。另从 Chromium 获取固定提交 `94644361b4fc21befdadbf425a5d256b17f20565`，将 v3.24 原件与 Git 树中的 190 个路径、可执行模式和 Git blob 逐一比对，全部相符。v3.24 原件重取后字节相同，SHA-256 为 `2e11ada5992dcce18f2e468573a03f04f6defb203cd7608e52cb38fb7966772e`。[固定 APKBUILD](https://raw.githubusercontent.com/alpinelinux/aports/6d055fa770a2fbbd807ee496c4dc8c69d00fbee4/main/libyuv/APKBUILD) · [Chromium 固定提交](https://chromium.googlesource.com/libyuv/libyuv/+/94644361b4fc21befdadbf425a5d256b17f20565/) · [Alpine v3.24 原件](https://distfiles.alpinelinux.org/distfiles/v3.24/libyuv-0.0.1928.tar.gz)

伴随包门禁将这份原件绑定到唯一的包身份、APKBUILD 摘要、文件名、URL 和归档摘要。配方中的 `skip-s390x.patch` 继续核对原 SHA-512。后续版本或归档变化时按固定配方重新收集和复核。

## 验证与接续

- 合并 Debian 两批清单与本批清单，用 `sourceCoverage` 和 `mise exec -- pnpm prepare:source-bundle` 读取 114 项实际输入。门禁处理完这些材料后报告缺少 14 项，目录与归档均未生成。
- 在临时副本改变 libyuv 归档、APKBUILD 或 URL，分别被拒绝。删除 BusyBox 的一项配方补丁也被拒绝。
- `mise exec -- pnpm test:governance` 通过 133 项测试，仓库检查和 `git diff --check` 通过。收集阶段读取配方与归档，实际重建与签名信任链仍待验。
- 接续项包括两个 Alpine MIT 通知、6 个 Nginx 供应商包、Node 与 npm / Corepack / Yarn、两类容器启动配方，共 14 项。材料齐备后再验证真实伴随包和四个最终镜像。
