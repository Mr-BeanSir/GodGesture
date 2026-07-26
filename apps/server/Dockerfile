# ============================================================
# GodGesture 后端镜像(多阶段,pnpm workspace 感知)
# 构建上下文 = 仓库根目录:
#   docker build -f apps/server/Dockerfile -t godgesture-server .
# ============================================================

# ---------- 基础:Node 22 + pnpm(corepack) ----------
FROM node:22-slim AS base
# 大陆网络可选:--build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
ARG PRISMA_ENGINES_MIRROR=
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH \
  PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
# openssl:让 prisma generate 正确探测 openssl 3 并下载对应查询引擎
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

# ---------- 构建:全量依赖 + 编译 shared/server ----------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @godgesture/server... --filter .
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @godgesture/shared build \
  && pnpm --filter @godgesture/server exec prisma generate \
  && pnpm --filter @godgesture/server build

# ---------- 生产依赖:仅 prod 依赖 + Prisma Client 生成 ----------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @godgesture/server... --filter .
COPY apps/server/prisma apps/server/prisma
# 在生产依赖树内生成 Prisma Client(引擎按 debian-openssl-3.x 下载)
RUN pnpm --filter @godgesture/server exec prisma generate

# ---------- 运行时:slim + openssl(Prisma 引擎依赖) ----------
FROM node:22-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo

# pnpm 的 node_modules 结构依赖相对符号链接,按 workspace 布局整体拷贝
COPY --chown=node:node --from=prod-deps /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --chown=node:node --from=prod-deps /repo/node_modules node_modules
COPY --chown=node:node --from=prod-deps /repo/packages/shared packages/shared
COPY --chown=node:node --from=prod-deps /repo/apps/server apps/server
COPY --chown=node:node --from=build /repo/packages/shared/dist packages/shared/dist
COPY --chown=node:node --from=build /repo/packages/shared/dist-cjs packages/shared/dist-cjs
COPY --chown=node:node --from=build /repo/apps/server/dist apps/server/dist

WORKDIR /repo/apps/server
EXPOSE 3000
USER node
# 启动前先跑迁移(幂等),再启动应用
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
