# Default worker target preserves the existing Compose API/worker/Zoekt image.
# Deploying the smaller API target requires dedicated workers (JOBS_WORKERS=0).
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
ENV GOTOOLCHAIN=local GOSUMDB=sum.golang.org
# One checksummed module owns tool versions and security-patched dependencies.
WORKDIR /opt/go-tools
COPY scripts/indexer-tools/go.mod scripts/indexer-tools/go.sum ./
RUN go install -mod=readonly github.com/scip-code/scip-go/cmd/scip-go \
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

FROM node:22.23.3-trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o APT::Update::Error-Mode=any update \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 install -y --no-install-recommends ca-certificates git libcurl3t64-gnutls \
 && test "$(dpkg-query -W -f='${Version}' libcurl3t64-gnutls)" != '' \
 && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libcurl3t64-gnutls)" ge '8.14.1-2+deb13u7' \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# API and indexing launchers execute node directly; npm is build-only.
RUN npm ci --omit=dev --no-audit --no-fund \
 && rm -rf /usr/local/lib/node_modules/npm \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts/run-migrations.mjs ./scripts/run-migrations.mjs
COPY src/server/databasePoolOptions.cjs ./src/server/databasePoolOptions.cjs
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
 CMD node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8787)+"/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "dist/webhookServer.js"]

FROM runtime AS api
COPY scripts/runtime-entrypoint /usr/local/bin/coop-runtime-entrypoint
RUN chmod 0755 /usr/local/bin/coop-runtime-entrypoint && test -x /usr/bin/setpriv && test -x /usr/bin/id
ENV HOME=/home/node
ENTRYPOINT ["/usr/local/bin/coop-runtime-entrypoint"]
CMD ["node", "dist/webhookServer.js"]
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
 CMD /usr/local/bin/coop-runtime-entrypoint node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8787)+"/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

FROM runtime AS worker
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o APT::Update::Error-Mode=any update \
 && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 install -y --no-install-recommends python3 python3-pip maven default-jdk-headless \
 && rm -rf /var/lib/apt/lists/*
# scip-go invokes the Go compiler/toolchain while analyzing real projects.
COPY --from=gotools /usr/local/go /usr/local/go
COPY --from=gotools /go/bin/scip-go /go/bin/zoekt-git-index /go/bin/zoekt-webserver /usr/local/bin/
COPY --from=gotools /provenance /opt/build-provenance
COPY --from=indexers /opt/indexers /opt/indexers
COPY --from=java-producer /opt/scip-java /opt/scip-java
COPY scripts/indexer-tools/scip-java-launcher /usr/local/bin/scip-java
RUN chmod +x /usr/local/bin/scip-java
ENV PATH="/opt/indexers/node_modules/.bin:/usr/local/go/bin:${PATH}" GOTOOLCHAIN=local
# Presence is necessary, but is not a language-indexing qualification result.
RUN python3 -m pip --version && mvn --version && go version && scip-go --version && scip-typescript --version && scip-python --version && scip-java --help

# Keep tool install/build layers cached; only runtime policy and writable data change.
COPY scripts/runtime-entrypoint /usr/local/bin/coop-runtime-entrypoint
RUN chmod 0755 /usr/local/bin/coop-runtime-entrypoint && test -x /usr/bin/setpriv && test -x /usr/bin/id \
 && install -d -o 1000 -g 1000 -m 0700 /home/node/.cache /home/node/.m2 /home/node/.gradle /home/node/go \
 && install -d -o 1000 -g 1000 -m 0750 /zoekt-indexes
ENV HOME=/home/node
ENTRYPOINT ["/usr/local/bin/coop-runtime-entrypoint"]
CMD ["node", "dist/webhookServer.js"]
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
 CMD /usr/local/bin/coop-runtime-entrypoint node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8787)+"/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
