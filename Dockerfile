# 本地构建和未来发布共用；不改变发布暂停状态。
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS builder
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN corepack enable && corepack prepare pnpm@9.0.2 --activate
RUN --mount=type=cache,id=radishink-pnpm-web,target=/root/.local/share/pnpm/store \
    pnpm install --filter @wemd/web... --frozen-lockfile
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY scripts/generate-web-notices.mjs ./scripts/generate-web-notices.mjs
COPY LICENSE ./LICENSE
COPY version.json ./version.json
COPY LICENSES/ ./LICENSES/
RUN pnpm --filter @wemd/web run build

FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS runtime
COPY --from=builder /build/apps/web/dist /opt/radishink-web
COPY nginx.conf /opt/radishink/nginx.conf.template
COPY deploy/web-entrypoint.sh /opt/radishink/web-entrypoint.sh
USER nginx
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/opt/radishink/web-entrypoint.sh"]
