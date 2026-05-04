# Stage 1: Build React client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build TypeScript server
FROM node:20-alpine AS server-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build:server

# Stage 3: Production image
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=server-builder /app/dist ./dist
COPY --from=client-builder /app/client/dist ./client/dist
COPY airports.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
