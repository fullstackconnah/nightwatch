# glibc base (not alpine/musl): the nvidia-container-toolkit injects the HOST's
# nvidia-smi binary, which is glibc-linked and cannot execute on musl. Do not
# switch this back to alpine.
# ---- deps ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- run ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# node uid 1000 matches the host user, so the ./data bind mount stays writable
USER node
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
