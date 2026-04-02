FROM node:22-slim

WORKDIR /app

# Install all dependencies (including devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build client bundles + server bundle
RUN npm run build

# Remove devDependencies to slim down the image
RUN npm prune --omit=dev

# Create data directory for SQLite
RUN mkdir -p /data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/server-entry.mjs"]
