ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS media-tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr tesseract-ocr-eng tesseract-ocr-heb tesseract-ocr-ara poppler-utils util-linux \
    && rm -rf /var/lib/apt/lists/*

FROM media-tools AS source
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/enrichment-worker/package.json apps/enrichment-worker/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/kafka/package.json packages/kafka/package.json
RUN npm ci
COPY . .

FROM source AS media-test
RUN apt-get update \
    && apt-get install -y --no-install-recommends pango1.0-tools fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
CMD ["npm", "run", "check"]

FROM source AS build
RUN npm run build && npm prune --omit=dev

FROM media-tools AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps ./apps
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
