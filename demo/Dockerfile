# Dev-mode image for the demo app. Source is bind-mounted via docker-compose so
# Next.js hot reload reflects file edits the MCP server writes.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
# -H 0.0.0.0 so the published port is reachable from the host.
CMD ["sh", "-c", "npm run dev -- -H 0.0.0.0"]
