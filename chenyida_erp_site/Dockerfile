# syntax=docker.io/docker/dockerfile:1.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720
FROM node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS=--max-old-space-size=1024 npm ci --ignore-scripts --no-audit --no-fund
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
RUN node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const source = JSON.parse(readFileSync("package.json", "utf8")); const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/; if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.name !== "string" || source.name.length === 0 || typeof source.version !== "string" || !versionPattern.test(source.version) || source.private !== true || !["module", "commonjs"].includes(source.type)) throw new Error("invalid source package metadata"); const runtimePackage = { name: source.name, version: source.version, private: source.private, type: source.type }; writeFileSync("/tmp/chenyida-runtime-package.json", JSON.stringify(runtimePackage, null, 2) + "\n", { encoding: "utf8", flag: "wx" });'
RUN node --input-type=module -e 'import { readFileSync } from "node:fs"; const source=JSON.parse(readFileSync("package.json","utf8")); const [version,revision]=process.argv.slice(1); if(version!==source.version||!/^[0-9a-f]{40}$/.test(revision||"")) throw new Error("invalid immutable release metadata");' "$ERP_BUILD_VERSION" "$ERP_BUILD_REVISION"

FROM dependencies AS builder
COPY . .
RUN --network=none NODE_OPTIONS=--max-old-space-size=1024 npm run build

FROM dependencies AS worker-dependencies
RUN --network=none NODE_OPTIONS=--max-old-space-size=1024 npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed AS web
RUN apk add --no-cache --repository=https://apk.cgr.dev/chainguard nodejs-22-minimal=22.23.2-r1 \
    && [ "$(node --version)" = "v22.23.2" ]
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
LABEL org.opencontainers.image.version=$ERP_BUILD_VERSION org.opencontainers.image.revision=$ERP_BUILD_REVISION
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 ERP_RUNTIME_BUILD_VERSION=$ERP_BUILD_VERSION ERP_RUNTIME_GIT_COMMIT=$ERP_BUILD_REVISION
WORKDIR /app
COPY --from=builder --chown=65532:65532 /app/dist/standalone ./
COPY --from=dependencies --chown=65532:65532 /tmp/chenyida-runtime-package.json ./package.json
COPY --from=builder --chown=root:root /app/drizzle-postgres ./drizzle-postgres
RUN find ./drizzle-postgres -type d -exec chmod 0555 {} + && find ./drizzle-postgres -type f -exec chmod 0444 {} +
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R 65532:65532 /data/chenyida-erp
USER 65532:65532
EXPOSE 3000
CMD ["node", "server.js"]

FROM cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed AS worker
RUN apk add --no-cache --repository=https://apk.cgr.dev/chainguard nodejs-22-minimal=22.23.2-r1 \
    && [ "$(node --version)" = "v22.23.2" ]
ARG ERP_BUILD_VERSION
ARG ERP_BUILD_REVISION
LABEL org.opencontainers.image.version=$ERP_BUILD_VERSION org.opencontainers.image.revision=$ERP_BUILD_REVISION
ENV NODE_ENV=production ERP_RUNTIME_BUILD_VERSION=$ERP_BUILD_VERSION ERP_RUNTIME_GIT_COMMIT=$ERP_BUILD_REVISION
WORKDIR /app
COPY --from=worker-dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=dependencies --chown=65532:65532 /tmp/chenyida-runtime-package.json ./package.json
COPY --chown=65532:65532 app ./app
COPY --chown=65532:65532 db ./db
COPY --chown=root:root drizzle-postgres ./drizzle-postgres
COPY --chown=65532:65532 release ./release
COPY --chown=65532:65532 scripts ./scripts
COPY --chown=65532:65532 seeds ./seeds
COPY --chown=65532:65532 tests ./tests
COPY --chown=65532:65532 worker ./worker
RUN find ./drizzle-postgres -type d -exec chmod 0555 {} + && find ./drizzle-postgres -type f -exec chmod 0444 {} +
RUN mkdir -p /data/chenyida-erp/uploads /data/chenyida-erp/attachments && chown -R 65532:65532 /data/chenyida-erp
USER 65532:65532
CMD ["node", "--experimental-strip-types", "worker/selfhost.ts"]
