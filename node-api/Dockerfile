# Node/Express API image. Build context is this directory (node-api/):
#   docker build -t skillovate-api -f node-api/Dockerfile node-api/
FROM node:18-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src
COPY sql ./sql
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 5000

USER node
CMD ["node", "src/server.js"]
