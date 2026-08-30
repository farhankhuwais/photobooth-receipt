# Multi-stage build for photobooth-receipt (frontend + admin SPA + combined API server).
FROM node:22-slim AS build
WORKDIR /app
# Install all deps (need dev deps for tsc/vite build)
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY . .
# Build photobooth app (dist/) — Vite injects VITE_* env at build time
ARG VITE_LICENSE_SECRET
ARG VITE_LICENSE_ENFORCE=0
ENV VITE_LICENSE_SECRET=$VITE_LICENSE_SECRET
ENV VITE_LICENSE_ENFORCE=$VITE_LICENSE_ENFORCE
RUN npm run build

# Build admin SPA (dist/admin/)
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json* ./
RUN npm install --include=dev
COPY admin/ ./
RUN npm run build

# Runtime stage: production deps only + built dist
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Copy built photobooth app + admin SPA + server entrypoints
COPY --from=build /app/dist ./dist
COPY serve.mjs db.mjs admin-api.mjs ./
COPY src/lib/licenseUtil.js ./src/lib/licenseUtil.js
COPY src/lib/licenseSecret.mjs ./src/lib/licenseSecret.mjs
# License secret persistence: generated on first run, stored on host
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "serve.mjs"]
