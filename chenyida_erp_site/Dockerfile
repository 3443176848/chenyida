# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS=--max-old-space-size=1024 npm ci --ignore-scripts
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
RUN node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const source = JSON.parse(readFileSync("package.json", "utf8")); const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/; if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.name !== "string" || source.name.length === 0 || typeof source.version !== "string" || !versionPattern.test(source.version) || source.private !== true || !["module", "commonjs"].includes(source.type)) throw new Error("invalid source package metadata"); const runtimePackage = { name: source.name, version: source.version, private: source.private, type: source.type }; writeFileSync("/tmp/chenyida-runtime-package.json", JSON.stringify(runtimePackage, null, 2) + "\n", { encoding: "utf8", flag: "wx" });'
RUN node --input-type=module -e 'import { readFileSync } from "node:fs"; const source=JSON.parse(readFileSync("package.json","utf8")); const [version,revision]=process.argv.slice(1); if(version!==source.version||!/^[0-9a-f]{40}$/.test(revision||"")) throw new Error("invalid immutable release metadata");' "$ERP_BUILD_VERSION" "$ERP_BUILD_REVISION"

FROM dependencies AS builder
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=1024 npm run build

FROM node:22-bookworm-slim AS web
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
LABEL org.opencontainers.image.version=$ERP_BUILD_VERSION org.opencontainers.image.revision=$ERP_BUILD_REVISION
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 ERP_RUNTIME_BUILD_VERSION=$ERP_BUILD_VERSION ERP_RUNTIME_GIT_COMMIT=$ERP_BUILD_REVISION
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist/standalone ./
COPY --from=dependencies --chown=node:node /tmp/chenyida-runtime-package.json ./package.json
COPY --from=builder --chown=root:root /app/drizzle-postgres ./drizzle-postgres
RUN find ./drizzle-postgres -type d -exec chmod 0555 {} + && find ./drizzle-postgres -type f -exec chmod 0444 {} +
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R node:node /data/chenyida-erp
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-bookworm-slim AS worker
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
LABEL org.opencontainers.image.version=$ERP_BUILD_VERSION org.opencontainers.image.revision=$ERP_BUILD_REVISION
ENV NODE_ENV=production ERP_RUNTIME_BUILD_VERSION=$ERP_BUILD_VERSION ERP_RUNTIME_GIT_COMMIT=$ERP_BUILD_REVISION
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=dependencies /tmp/chenyida-runtime-package.json /tmp/chenyida-runtime-package.json
RUN node --input-type=module -e 'import { readFileSync, unlinkSync } from "node:fs"; const source=JSON.parse(readFileSync("package.json","utf8")); const validated=JSON.parse(readFileSync("/tmp/chenyida-runtime-package.json","utf8")); const keys=["name","version","private","type"]; if(Object.keys(validated).length!==keys.length||keys.some((key)=>source[key]!==validated[key])) throw new Error("source package metadata was not validated by the shared release stage"); unlinkSync("/tmp/chenyida-runtime-package.json");'
RUN NODE_OPTIONS=--max-old-space-size=1024 npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node app ./app
COPY --chown=node:node db ./db
COPY --chown=root:root drizzle-postgres ./drizzle-postgres
COPY --chown=node:node release ./release
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node seeds ./seeds
COPY --chown=node:node tests ./tests
COPY --chown=node:node worker ./worker
RUN find ./drizzle-postgres -type d -exec chmod 0555 {} + && find ./drizzle-postgres -type f -exec chmod 0444 {} +
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R node:node /data/chenyida-erp
USER node
CMD ["node", "--experimental-strip-types", "worker/selfhost.ts"]
