FROM node:20-alpine AS builder

WORKDIR /app

# Copy the monorepo files
COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY connectors/ ./connectors/
COPY engine/ ./engine/

# Install dependencies and build
RUN npm install
RUN npm run build -w @trading-tower/shared
RUN npm run build -w @trading-tower/connectors
RUN npm run build -w @trading-tower/engine

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/connectors/dist ./connectors/dist
COPY --from=builder /app/connectors/package.json ./connectors/package.json
COPY --from=builder /app/engine/dist ./engine/dist
COPY --from=builder /app/engine/package.json ./engine/package.json

WORKDIR /app/engine
CMD ["node", "dist/index.js"]
