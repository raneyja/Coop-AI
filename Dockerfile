# ── Stage 1: TypeScript build ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.backend.json ./
COPY src ./src
RUN npm run build:backend && npm run build:workers

# ── Stage 2: Go tools (scip-go + Zoekt binaries) ─────────────────────────────
FROM golang:1.25-bookworm AS gotools

# scip-go: compiler-accurate Go symbol indexer (produces .scip files)
RUN go install github.com/scip-code/scip-go/cmd/scip-go@latest

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
#   curl             — scip-java jar download
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 default-jdk-headless curl \
  && rm -rf /var/lib/apt/lists/*

# npm-based SCIP indexers
RUN npm install -g @sourcegraph/scip-typescript @sourcegraph/scip-python

# Go-based binaries from the gotools stage
COPY --from=gotools /go/bin/scip-go /go/bin/zoekt-git-index /go/bin/zoekt-webserver \
  /usr/local/bin/

# scip-java: standalone jar + shell wrapper
# Pin to a known-good release. Update SCIP_JAVA_VERSION to bump.
ARG SCIP_JAVA_VERSION=0.9.8
RUN curl -fsSL \
    "https://github.com/sourcegraph/scip-java/releases/download/v${SCIP_JAVA_VERSION}/scip-java.jar" \
    -o /usr/local/lib/scip-java.jar \
  && printf '#!/bin/sh\nexec java -jar /usr/local/lib/scip-java.jar "$@"\n' \
    > /usr/local/bin/scip-java \
  && chmod +x /usr/local/bin/scip-java \
  || echo "WARN: scip-java download failed — Java/Kotlin indexing will fall back to tree-sitter"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8787/health || exit 1

CMD ["node", "dist/webhookServer.js"]
