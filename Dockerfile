# Quiet Accounts in one container: the server, the worker and the operator console, in one Node process.
#   docker build -t quiet-accounts .
#   docker run -p 127.0.0.1:8787:8787 -v quiet-accounts-data:/data --env-file .env quiet-accounts   (behind your https proxy)
# The database lives on the volume mounted at /data, and its nightly backups in /data/backups. See "Run it" in README.md.

# node:sqlite needs Node 22.5 or later.
FROM node:22-bookworm-slim AS base
# pnpm at the version package.json pins (packageManager), without asking
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# the workspace's manifests first, so a code change doesn't reinstall the dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/

# The operator console: a static build the server serves.
FROM base AS console
RUN pnpm install --frozen-lockfile --filter @qa/web...
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN pnpm --filter @qa/web build

# The server and the worker: only their own dependencies (tsx runs the TypeScript).
FROM base
RUN pnpm install --frozen-lockfile --prod --filter @qa/server...
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY --from=console /app/apps/web/dist apps/web/dist
ENV PORT=8787 DATABASE_PATH=/data/quiet-accounts.db
EXPOSE 8787
# Runs as root: hosts mount volumes owned by root, and the server must write the database there.
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "--no-warnings=ExperimentalWarning", "src/main.ts"]
