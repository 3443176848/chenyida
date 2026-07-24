# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist/standalone ./
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R node:node /data/chenyida-erp
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node app ./app
COPY --chown=node:node db ./db
COPY --chown=node:node drizzle-postgres ./drizzle-postgres
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node seeds ./seeds
COPY --chown=node:node tests ./tests
COPY --chown=node:node worker ./worker
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R node:node /data/chenyida-erp
USER node
CMD ["node", "--experimental-strip-types", "worker/selfhost.ts"]
