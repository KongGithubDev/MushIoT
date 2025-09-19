# ------------ Build stage ------------
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Build Vite app
RUN npm run build

# ------------ Production stage ------------
FROM node:20-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy server and built assets
COPY --from=build /app/dist ./dist
COPY server.js ./server.js

# Expose port
EXPOSE 3000

# Healthcheck (optional)
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
