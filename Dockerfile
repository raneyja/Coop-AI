# ── Stage 1: TypeScript build ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.backend.json ./
COPY src ./src
COPY scripts/admin-org.ts ./scripts/admin-org.ts
RUN npm run build:backend && npm run build:workers && npm run build:admin

# ── Stage 2: Go tools (scip-go + Zoekt binaries) ─────────────────────────────
FROM golang:1.25-bookworm AS gotools

# scip-go: compiler-accurate Go symbol indexer (produces .scip files)
RUN go install github.com/scip-code/scip-go/cmd/scip-go@v0.2.7

# Zoekt: Google's full-text code search engine
# zoekt-git-index: builds the shard index from a git repo
# zoekt-webserver: HTTP server that serves search over shards
RUN go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@latest \
  && go install github.com/sourcegraph/zoekt/cmd/zoekt-webserver@latest

# ── Stage 3: Runtime image ────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# System deps:
#   git              — repository cloning
#   ca-certificates  — HTTPS in Node fetch
#   python3          — required by scip-python
#   default-jdk-headless — Java runtime for scip-java
#   maven            — Maven repositories indexed by scip-java
#   curl             — pinned indexer bootstrap downloads
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 default-jdk-headless maven curl \
  && rm -rf /var/lib/apt/lists/*

# npm-based SCIP indexers
RUN npm install -g @sourcegraph/scip-typescript @sourcegraph/scip-python

# scip-go shells out to the Go command while loading a repository. Keep the
# indexer and its matching toolchain together in the production runtime.
COPY --from=gotools /go/bin/scip-go /go/bin/zoekt-git-index /go/bin/zoekt-webserver \
  /usr/local/bin/
COPY --from=gotools /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}" \
    GOTOOLCHAIN=local

# scip-java v0.9.8 has no GitHub release asset. Build the standalone launcher
# from its pinned Maven Central artifact using a checksum-pinned Coursier jar.
ARG SCIP_JAVA_VERSION=0.9.8
ARG COURSIER_VERSION=2.1.26
ARG COURSIER_SHA256=d3135830850eddfb9998be66ab4c79478ee6cff56012bb5a177532b1df47c7cc
RUN curl -fsSL \
    "https://github.com/coursier/coursier/releases/download/v${COURSIER_VERSION}/coursier.jar" \
    -o /tmp/coursier.jar \
  && echo "${COURSIER_SHA256}  /tmp/coursier.jar" | sha256sum -c - \
  && java -jar /tmp/coursier.jar bootstrap --standalone \
    -o /usr/local/bin/scip-java \
    "com.sourcegraph:scip-java_2.13:${SCIP_JAVA_VERSION}" \
    --main com.sourcegraph.scip_java.ScipJava \
  && chmod +x /usr/local/bin/scip-java \
  && /usr/local/bin/scip-java --help >/dev/null \
  && rm -f /tmp/coursier.jar

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts/run-migrations.mjs ./scripts/run-migrations.mjs

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8787}/health" || exit 1'

CMD ["node", "dist/webhookServer.js"]
