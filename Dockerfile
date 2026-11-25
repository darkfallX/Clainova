# One process and one volume: SQLite and the sponsor queue expect a single instance.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p /data && chown node:node /data
ENV MODE=testnet HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
USER node
EXPOSE 8080
CMD ["node", "server/start.mjs"]
