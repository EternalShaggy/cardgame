FROM node:20-alpine AS builder

WORKDIR /app

# Copy entire monorepo (needed for workspace symlinks)
COPY package.json package-lock.json* ./
COPY packages/ ./packages/
COPY apps/backend/ ./apps/backend/

# Install all workspace deps
RUN npm install --ignore-scripts

# Build shared, then backend
RUN npm run build:shared && npm run build:backend

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/package.json

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "apps/backend/dist/main.js"]
