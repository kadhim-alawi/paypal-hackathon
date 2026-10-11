# syntax=docker/dockerfile:1.7
# Tideover: one image serving the API, the PayPal checkout page and the Flutter web app.

# ---- 1. Flutter web build ----------------------------------------------------
FROM debian:bookworm-slim AS web
ARG FLUTTER_VERSION=3.47.7
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils unzip \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
  | tar -xJ -C /opt \
 && git config --global --add safe.directory /opt/flutter
ENV PATH="/opt/flutter/bin:${PATH}"
RUN flutter config --no-analytics --enable-web >/dev/null && flutter precache --web
WORKDIR /app
COPY app/pubspec.yaml app/pubspec.lock ./
RUN flutter pub get
COPY app/ ./
RUN flutter build web --release --no-web-resources-cdn --no-wasm-dry-run

# ---- 2. AG Grid bundle for the staff Ledger (only the modules it uses) -------
FROM node:22-bookworm-slim AS aggrid
WORKDIR /aggrid
COPY tools/aggrid/package.json tools/aggrid/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tools/aggrid/entry.mjs ./
RUN OUT=/aggrid/aggrid.js npm run build

# ---- 3. Server build ---------------------------------------------------------
FROM node:22-bookworm-slim AS server
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---- 4. Runtime --------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIR=/srv/web \
    DATA_DIR=/srv/data
WORKDIR /srv
COPY --from=server /srv/package.json ./
COPY --from=server /srv/node_modules ./node_modules
COPY --from=server /srv/dist ./dist
COPY --from=web /app/build/web ./web
COPY --from=aggrid /aggrid/aggrid.js ./web/ledger/aggrid.js
COPY demo-assets ./demo-assets
RUN mkdir -p /srv/data && chown -R node:node /srv/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
