# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# The MCP server listens here; bind to 0.0.0.0 so the published port is
# reachable from the host (override-able via env).
ENV HOST=0.0.0.0
ENV PORT=4399
EXPOSE 4399

CMD ["node", "dist/index.js"]
