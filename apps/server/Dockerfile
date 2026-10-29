FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS builder
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
RUN corepack enable && corepack prepare pnpm@9.0.2 --activate
RUN --mount=type=cache,id=radishink-pnpm-server,target=/root/.local/share/pnpm/store \
    pnpm install --filter @wemd/server --frozen-lockfile
COPY apps/server/ ./apps/server/
RUN pnpm --filter @wemd/server run build
RUN --mount=type=cache,id=radishink-pnpm-server,target=/root/.local/share/pnpm/store \
    pnpm --filter @wemd/server deploy --prod /runtime

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /runtime/node_modules ./node_modules
COPY --from=builder /build/apps/server/dist ./dist
COPY deploy/server-healthcheck.cjs ./healthcheck.cjs
COPY LICENSE ./LICENSE
COPY LICENSES/ ./LICENSES/
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
