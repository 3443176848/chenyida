# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS=--max-old-space-size=1024 npm ci --ignore-scripts

FROM dependencies AS builder
COPY . .
RUN node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const source = JSON.parse(readFileSync("package.json", "utf8")); const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/; if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.name !== "string" || source.name.length === 0 || typeof source.version !== "string" || !versionPattern.test(source.version) || source.private !== true || !["module", "commonjs"].includes(source.type)) throw new Error("invalid source package metadata"); const runtimePackage = { name: source.name, version: source.version, private: source.private, type: source.type }; writeFileSync("/tmp/chenyida-runtime-package.json", JSON.stringify(runtimePackage, null, 2) + "\n", { encoding: "utf8", flag: "wx" });'
RUN NODE_OPTIONS=--max-old-space-size=1024 npm run build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist/standalone ./
COPY --from=builder --chown=node:node /tmp/chenyida-runtime-package.json ./package.json
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R node:node /data/chenyida-erp
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS=--max-old-space-size=1024 npm ci --omit=dev --ignore-scripts && npm cache clean --force
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
