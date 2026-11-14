# Production Dockerfile for Playwright Headless + Hono on Google Cloud Run
# Official Microsoft Playwright Noble image contains Chromium and all OS dependencies
FROM mcr.microsoft.com/playwright:v1.50.0-noble AS runner

WORKDIR /app

# Enable pnpm via corepack matching monorepo version
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# Copy monorepo workspace configurations and dependencies manifests
COPY pnpm-lock.yaml* pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/sandbox-api/package.json ./apps/sandbox-api/

# Install dependencies (only for @zeroleak/sandbox-api and its workspace dependencies)
RUN pnpm install --frozen-lockfile --filter @zeroleak/sandbox-api...

# Copy sandbox-api source files
COPY apps/sandbox-api/ ./apps/sandbox-api/

# Compile TypeScript
RUN pnpm --filter @zeroleak/sandbox-api build

# Google Cloud Run configuration
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Built-in lightweight health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the compiled service
CMD ["node", "apps/sandbox-api/dist/index.js"]
