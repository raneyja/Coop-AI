FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.backend.json ./
COPY src ./src

RUN npm run build:backend && npm run build:workers

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @sourcegraph/scip-typescript @sourcegraph/scip-python

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "dist/webhookServer.js"]
