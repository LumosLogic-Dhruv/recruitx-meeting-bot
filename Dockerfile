# ── Stage 1: Build Next.js frontend ──────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=""

RUN npm run build

# ── Stage 2: Final production image ──────────────────────────────────────────
FROM python:3.12-slim

# Install Node.js 20, Caddy, supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg debian-keyring debian-archive-keyring apt-transport-https \
    supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
        gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
        tee /etc/apt/sources.list.d/caddy-stable.list && \
    apt-get update && apt-get install -y caddy && \
    rm -rf /var/lib/apt/lists/*

# Create log directory for supervisor
RUN mkdir -p /var/log/supervisor

# ── Backend (FastAPI + uvicorn) ───────────────────────────────────────────────
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./

# ── Frontend (Next.js standalone) ────────────────────────────────────────────
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static ./.next/static
COPY --from=frontend-builder /app/frontend/public ./public

# ── Config files ──────────────────────────────────────────────────────────────
COPY Caddyfile /etc/caddy/Caddyfile
COPY supervisord.conf /etc/supervisor/conf.d/app.conf

# Caddy data & config volumes (SSL certs persist here)
VOLUME ["/data", "/config"]

EXPOSE 80 443

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/app.conf"]
