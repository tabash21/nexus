ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/kafka/package.json packages/kafka/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps ./apps
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/infra/connect/s3-sink.local.json ./infra/connect/s3-sink.local.json
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
