# Multi-stage Dockerfile for Playwright + Hono on Google Cloud Run
FROM mcr.microsoft.com/playwright:v1.50.0-noble AS base

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# Copy root monorepo manifest and locks
COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/sandbox-api/package.json ./apps/sandbox-api/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @zeroleak/sandbox-api...

# Copy source
COPY apps/sandbox-api/ ./apps/sandbox-api/

# Build
RUN pnpm --filter @zeroleak/sandbox-api build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/sandbox-api/dist/index.js"]

