FROM mcr.microsoft.com/playwright:v1.50.0-noble AS runner

WORKDIR /app

# Cài đặt pnpm
RUN npm install -g pnpm@11.8.0

# Copy toàn bộ mã nguồn (đã loại trừ node_modules qua .dockerignore, bao gồm cả tsconfig.base.json)
COPY . .

# Cài đặt dependencies
RUN pnpm install --no-frozen-lockfile

# Cài đặt browser Chromium cho Playwright
RUN pnpm --filter @zeroleak/sandbox-api exec playwright install chromium

# Build shared-types và sandbox-api
RUN pnpm --filter @zeroleak/shared-types build && pnpm --filter @zeroleak/sandbox-api build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/sandbox-api/dist/index.js"]
