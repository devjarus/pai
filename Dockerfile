# ---- Stage 1: Build ----
FROM node:20-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.3 --activate

# better-sqlite3 and onnxruntime-node need build tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

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
COPY packages/plugin-research/package.json packages/plugin-research/tsconfig.json packages/plugin-research/
COPY packages/plugin-schedules/package.json packages/plugin-schedules/tsconfig.json packages/plugin-schedules/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ packages/

# Build all packages (TypeScript + Vite UI)
RUN pnpm build

# Prune dev dependencies to shrink the runtime layer
RUN pnpm prune --prod


# ---- Stage 2: Runtime ----
FROM node:20-slim AS runtime

# better-sqlite3 needs libstdc++; onnxruntime-node needs glibc (not available on Alpine)
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*

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

COPY --from=builder /app/packages/plugin-research/dist packages/plugin-research/dist
COPY --from=builder /app/packages/plugin-research/package.json packages/plugin-research/
COPY --from=builder /app/packages/plugin-research/node_modules packages/plugin-research/node_modules

COPY --from=builder /app/packages/plugin-schedules/dist packages/plugin-schedules/dist
COPY --from=builder /app/packages/plugin-schedules/package.json packages/plugin-schedules/

# Create non-root user for runtime security
RUN groupadd --gid 1001 pai && useradd --uid 1001 --gid pai --shell /bin/false pai

# Create data directory (Railway volume mounts here at runtime)
RUN mkdir -p /data && chown pai:pai /data

# Ensure app files are owned by the non-root user
RUN chown -R pai:pai /app

EXPOSE 3141

# Note: Do not use VOLUME or HEALTHCHECK directives — Railway bans them.
# Railway manages volumes and healthchecks via railway.toml / dashboard.
# For local Docker, use: docker run -v pai-data:/data ...

COPY --chown=pai:pai docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Entrypoint runs as root to fix volume permissions, then drops to pai
CMD ["/app/docker-entrypoint.sh"]
