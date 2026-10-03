FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@11.19.0 \
  && pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache su-exec \
  && addgroup -S bookshelf \
  && adduser -S bookshelf -G bookshelf \
  && mkdir -p /data \
  && chown bookshelf:bookshelf /data
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=bookshelf:bookshelf package*.json ./
COPY --chown=bookshelf:bookshelf src ./src
COPY --chown=bookshelf:bookshelf public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
