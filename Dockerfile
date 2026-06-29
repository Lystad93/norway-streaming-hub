# syntax=docker/dockerfile:1
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# App source
COPY . .

EXPOSE 7000
CMD ["node", "server.js"]
