# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (sharp, canvas)
RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json drizzle.config.ts ./
COPY src/ ./src/

RUN npm run build

# Copy static assets after build
COPY src/assets/ ./dist/assets/

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Runtime deps only (ffmpeg + vips for sharp)
RUN apk add --no-cache \
    ffmpeg \
    vips \
    curl \
    && addgroup -S appgroup \
    && adduser  -S appuser -G appgroup

# Copy compiled output and static assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY drizzle.config.ts ./

# Uploads directory (mapped as volume in docker-compose)
RUN mkdir -p uploads && chown appuser:appgroup uploads

# Run as non-root for security
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
