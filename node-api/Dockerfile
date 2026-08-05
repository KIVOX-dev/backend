# Node/Express API image. Build context is this directory (node-api/):
#   docker build -t upscaler-ai-node-api -f node-api/Dockerfile node-api/

# ---- deps: install production dependencies in an isolated stage ----
# bcrypt needs a native build toolchain on some platforms/registries; keeping
# it in its own stage means python3/make/g++ never reach the final image.
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- runtime: slim final image — only installed deps + app source ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The base image bundles a global npm CLI (+ corepack) for convenience, but
# this container only ever runs `node src/server.js` — npm never executes
# here. That bundled npm vendors its own internal deps (tar, undici,
# brace-expansion, ...) pinned to whatever shipped with this Node build,
# which lag behind upstream security fixes independently of anything in
# this project's package.json/package-lock.json — Trivy flags them as
# CRITICAL/HIGH even though they're unreachable dead weight. Removing the
# global npm/corepack install (not the `node` binary) drops that surface
# entirely; the db:seed-*/loadtest scripts in package.json are one-line
# `node scripts/x.js` wrappers anyway, so `docker exec ... node scripts/x.js`
# still works identically without npm present.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# middlewares/upload.js creates uploads/profile itself at module load time
# (mkdirSync, not inside a request handler) — but as the non-root `node`
# user below, it has no permission to create a new directory under /app
# (owned by root from the COPY steps above). Create it here, as root, with
# the right ownership, before dropping privileges. Without this the process
# crashes on startup (routes/index.js requires every route file, including
# profile.routes.js, before the server ever binds a port) — verified by
# actually building and running this image; it never got past `docker run`.
RUN mkdir -p uploads/profile && chown -R node:node uploads

EXPOSE 5000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/health', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
