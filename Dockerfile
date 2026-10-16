# Worker and Zoekt image. The API has its own minimal Dockerfile.api.
FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN test "$(npm --version)" = "10.9.9" && npm ci --no-audit --no-fund
COPY tsconfig.backend.json ./
COPY src ./src
COPY scripts/admin-org.ts ./scripts/admin-org.ts
COPY scripts/local-demo-db-target.ts ./scripts/local-demo-db-target.ts
RUN npm run build:backend && npm run build:workers && npm run build:admin

FROM golang:1.26.9-bookworm AS gotools
ENV GOTOOLCHAIN=local GOSUMDB=sum.golang.org CGO_ENABLED=0
# One checksummed module owns tool versions and security-patched dependencies.
WORKDIR /opt/go-tools
COPY scripts/indexer-tools/go.mod scripts/indexer-tools/go.sum ./
RUN --mount=type=cache,id=coop-s5-go-static-mod,target=/go/pkg/mod \
    --mount=type=cache,id=coop-s5-go-static-build,target=/root/.cache/go-build \
    go install -mod=readonly github.com/scip-code/scip-go/cmd/scip-go \
      github.com/sourcegraph/zoekt/cmd/zoekt-git-index \
      github.com/sourcegraph/zoekt/cmd/zoekt-webserver \
 && mkdir /provenance \
 && cp go.mod go.sum /provenance/ \
 && go version > /provenance/go-version.txt \
 && go version -m /go/bin/scip-go /go/bin/zoekt-git-index /go/bin/zoekt-webserver > /provenance/go-build-info.txt

# Build the complete pinned producer distribution natively on the builder.
FROM --platform=$BUILDPLATFORM eclipse-temurin:25@sha256:8c0a84ea11c8f6ed52600fc19f1040121f2a162998e9f50a5faebbbad9172dcc AS java-producer
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 \
 && rm -rf /var/lib/apt/lists/*
COPY scripts/indexer-tools/scip-java.json scripts/indexer-tools/scip-java.py /build/
RUN --mount=type=cache,id=coop-scip-java-gradle,target=/root/.gradle python3 /build/scip-java.py build

FROM node:22.23.3-trixie-slim AS indexers
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl default-jdk-headless \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/indexers
COPY scripts/indexer-tools/package.json scripts/indexer-tools/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.3-alpine3.23@sha256:489418a947387da1c5b4c0c5749c963da56ecaac0ced1da74c67db60e42f2b3a AS worker
RUN apk add --no-cache ca-certificates curl git libcurl python3 py3-pip maven openjdk25-jdk
WORKDIR /app
COPY package.json package-lock.json ./
# Install against musl, then remove npm; runtime never invokes the package manager.
RUN --mount=type=cache,id=coop-s5-worker-alpine-npm,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
 && rm -rf /usr/local/lib/node_modules/npm \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts/run-migrations.mjs ./scripts/run-migrations.mjs
COPY src/server/databasePoolOptions.cjs ./src/server/databasePoolOptions.cjs
# scip-go invokes the Go compiler/toolchain while analyzing real projects.
COPY --from=gotools /usr/local/go /usr/local/go
COPY --from=gotools /go/bin/scip-go /go/bin/zoekt-git-index /go/bin/zoekt-webserver /usr/local/bin/
COPY --from=gotools /provenance /opt/build-provenance
COPY --from=indexers /opt/indexers /opt/indexers
COPY --from=java-producer /opt/scip-java /opt/scip-java
COPY scripts/indexer-tools/scip-java-launcher /usr/local/bin/scip-java
RUN chmod +x /usr/local/bin/scip-java
ENV NODE_ENV=production PORT=8787 PATH="/opt/indexers/node_modules/.bin:/usr/local/go/bin:${PATH}" GOTOOLCHAIN=local
# Presence is necessary, but is not a language-indexing qualification result.
RUN python3 -m pip --version && mvn --version && go version && scip-go --version && scip-typescript --version && scip-python --version && scip-java --help

# Keep tool install/build layers cached; only runtime policy and writable data change.
COPY scripts/runtime-entrypoint /usr/local/bin/coop-runtime-entrypoint
RUN chmod 0755 /usr/local/bin/coop-runtime-entrypoint && command -v setpriv && test -x /usr/bin/id \
 && mkdir -p /home/node/.cache /home/node/.m2 /home/node/.gradle /home/node/go /zoekt-indexes \
 && chown -R node:node /home/node /zoekt-indexes
ENV HOME=/home/node
ENTRYPOINT ["/usr/local/bin/coop-runtime-entrypoint"]
CMD ["node", "dist/workerEntry.js"]
USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
 CMD /usr/local/bin/coop-runtime-entrypoint node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8787)+"/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
