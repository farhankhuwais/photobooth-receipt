# Multi-stage build for photobooth-receipt (frontend + combined API server).
FROM node:22-slim AS build
WORKDIR /app
# Install all deps (need dev deps for tsc/vite build)
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY . .
RUN npm run build

# Runtime stage: production deps only + built dist
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Copy built frontend + server entrypoints
COPY --from=build /app/dist ./dist
COPY serve.mjs db.mjs ./
EXPOSE 8080
CMD ["node", "serve.mjs"]
