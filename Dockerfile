# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate

# better-sqlite3 needs build tools on alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/cli/package.json packages/cli/tsconfig.json packages/cli/
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/ui/package.json packages/ui/tsconfig.json packages/ui/tsconfig.app.json packages/ui/tsconfig.node.json packages/ui/
COPY packages/plugin-assistant/package.json packages/plugin-assistant/tsconfig.json packages/plugin-assistant/
COPY packages/plugin-curator/package.json packages/plugin-curator/tsconfig.json packages/plugin-curator/
COPY packages/plugin-tasks/package.json packages/plugin-tasks/tsconfig.json packages/plugin-tasks/
COPY packages/plugin-telegram/package.json packages/plugin-telegram/tsconfig.json packages/plugin-telegram/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ packages/

# Build all packages (TypeScript + Vite UI)
RUN pnpm build

# Prune dev dependencies to shrink the runtime layer
RUN pnpm prune --prod


# ---- Stage 2: Runtime ----
FROM node:20-alpine AS runtime

# better-sqlite3 needs libstdc++ at runtime
RUN apk add --no-cache libstdc++

WORKDIR /app

ENV NODE_ENV=production
ENV PAI_DATA_DIR=/data

# Copy root package files
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./

# Copy pruned node_modules
COPY --from=builder /app/node_modules ./node_modules

# Copy each package: dist + package.json + node_modules (if any)
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/node_modules packages/core/node_modules

COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/node_modules packages/server/node_modules

COPY --from=builder /app/packages/cli/dist packages/cli/dist
COPY --from=builder /app/packages/cli/package.json packages/cli/
COPY --from=builder /app/packages/cli/node_modules packages/cli/node_modules

COPY --from=builder /app/packages/ui/dist packages/ui/dist
COPY --from=builder /app/packages/ui/package.json packages/ui/

COPY --from=builder /app/packages/plugin-assistant/dist packages/plugin-assistant/dist
COPY --from=builder /app/packages/plugin-assistant/package.json packages/plugin-assistant/
COPY --from=builder /app/packages/plugin-assistant/node_modules packages/plugin-assistant/node_modules

COPY --from=builder /app/packages/plugin-curator/dist packages/plugin-curator/dist
COPY --from=builder /app/packages/plugin-curator/package.json packages/plugin-curator/
COPY --from=builder /app/packages/plugin-curator/node_modules packages/plugin-curator/node_modules

COPY --from=builder /app/packages/plugin-tasks/dist packages/plugin-tasks/dist
COPY --from=builder /app/packages/plugin-tasks/package.json packages/plugin-tasks/
COPY --from=builder /app/packages/plugin-tasks/node_modules packages/plugin-tasks/node_modules

COPY --from=builder /app/packages/plugin-telegram/dist packages/plugin-telegram/dist
COPY --from=builder /app/packages/plugin-telegram/package.json packages/plugin-telegram/
COPY --from=builder /app/packages/plugin-telegram/node_modules packages/plugin-telegram/node_modules

# Create data volume mount point
RUN mkdir -p /data

EXPOSE 3141

VOLUME ["/data"]

CMD ["node", "packages/server/dist/index.js"]
