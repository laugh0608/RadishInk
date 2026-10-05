# 图床支持

RadishInk 默认关闭上传。配置并启用后，可使用自定义接口、七牛云、阿里云 OSS、腾讯云 COS 或 S3 兼容图床，均通过 `ImageHostManager` 统一管理。

## 支持的图床

| 图床       | 配置难度 | 说明                                         |
| ---------- | -------- | -------------------------------------------- |
| 不上传     | 无       | 默认状态，只使用已有图片链接                 |
| 自定义接口 | 手动配置 | 用户明确填写服务地址，兼容上游上传协议       |
| 七牛云     | ⭐⭐⭐   | 适合国内常见对象存储场景                     |
| 阿里云 OSS | ⭐⭐⭐   | 阿里云对象存储                               |
| 腾讯云 COS | ⭐⭐⭐   | 腾讯云对象存储                               |
| S3 兼容    | ⭐⭐⭐⭐ | 兼容 AWS S3 / Cloudflare R2 / MinIO / Spaces |

## 快速开始

### 1. 自定义上传接口

填写完整 HTTP / HTTPS 服务地址并启用。上传为 `POST <服务地址>/upload`，使用 multipart 文件字段 `file`，接口须返回含完整 HTTP / HTTPS `url` 的 JSON，并允许浏览器跨域。启用只验证地址格式，不代表远程连接成功。未配置时不使用任何默认服务。

旧的 `official` 存储类型和 `OfficialUploader` 类名仅用于兼容；没有显式 `serverUrl` 的旧配置按“不上传”处理，读取时不删除或重写原数据。已有的显式自定义地址及其他图床配置保留。

### 2. 七牛云

需要填写：

- `accessKey`
- `secretKey`
- `bucket`
- `domain`
- `region`（可选，默认 `z0`）

### 3. 阿里云 OSS

需要填写：

- `accessKeyId`
- `accessKeySecret`
- `bucket`
- `region`
- `cdnHost`（可选）
- `path`（可选）

### 4. 腾讯云 COS

需要填写：

- `secretId`
- `secretKey`
- `bucket`
- `region`
- `cdnHost`（可选）
- `path`（可选）

### 5. S3 兼容

需要填写：

- `endpoint`
- `region`
- `accessKeyId`
- `secretAccessKey`
- `bucket`
- `pathPrefix`（可选）
- `customDomain`（可选）
- `forcePathStyle`（可选，MinIO 常用）
- `legacyCompatibility`（可选，旧版 S3 兼容服务报 501 时开启）

## 使用示例

```typescript
import { ImageHostManager } from "./services/image/ImageUploader";
import { getStoredImageHostConfig } from "./services/image/imageHostConfig";

const config = getStoredImageHostConfig(); // 默认 none；上传会明确报错提示配置

const manager = new ImageHostManager(config);
const url = await manager.upload(file);
```

## 常见问题

### Q: 是否支持 PicGo / PicList？

不直接对接工具本身，但支持 S3 兼容协议。  
如果 PicGo / PicList 配置的是同一套 S3 参数，可与 RadishInk 共用同一存储后端。

### Q: 图片上传失败怎么办？

1. 检查图床配置是否完整。
2. 在图床设置面板点击“测试连接”。
3. 检查 Bucket 权限和 CORS 配置。
4. 查看浏览器控制台报错信息。

### Q: 测试连接返回 501 NotImplemented 怎么办？

新版 AWS SDK 会附加一些老版本 S3 兼容服务不认识的请求头（`x-amz-checksum-*`、
`x-amz-user-agent`）和 `x-id` 查询参数，老服务会直接返回 501。
在 S3 面板勾选“兼容旧版 S3”后重试。

背景参考：[S3 default integrity change](https://github.com/aws/aws-sdk-js-v3/issues/6810)（校验和请求头）、
[NotImplemented: search parameter x-id not implemented](https://github.com/aws/aws-sdk-js-v3/issues/5565)（`x-id` 查询参数）。

## 开发指南

### 添加新的图床支持

1. 在 `src/services/image/uploaders/` 新增 uploader。
2. 在 `ImageHostManager` 中注册新的 `type`。
3. 在 `ImageHostSettings` 中补充配置 UI。

## 数据去向

粘贴、拖入或选择图片会上传至已启用的服务；对象存储验证会发起请求，部分验证会上传并删除测试文件。图床凭据保存在当前浏览器，不是加密保管服务。关闭上传保留配置，损坏配置应明确报错，不回退到默认远程服务。
