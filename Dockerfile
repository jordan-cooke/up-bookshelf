FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S bookshelf && adduser -S bookshelf -G bookshelf
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=bookshelf:bookshelf package*.json ./
COPY --chown=bookshelf:bookshelf src ./src
COPY --chown=bookshelf:bookshelf public ./public
USER bookshelf
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server.js"]
