FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx

# Copy source
COPY . .

# Build client + server bundles
RUN npm run build

# Create data directory for SQLite
RUN mkdir -p /data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npx", "tsx", "server/index.ts"]
