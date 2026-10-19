ARG NODE_IMAGE=node:24-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json packages/contract/
COPY backend/package.json backend/
COPY web/package.json web/

FROM base AS deps
RUN pnpm install --filter @pathpulse/backend... --frozen-lockfile --prod

FROM base AS build
RUN pnpm install --filter @pathpulse/backend... --frozen-lockfile
COPY packages/contract packages/contract
COPY backend backend
RUN pnpm --filter @pathpulse/backend build

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps --chown=root:root /app /app
COPY --from=build --chown=root:root /app/packages/contract /app/packages/contract
COPY --from=build --chown=root:root /app/backend/dist /app/backend/dist
USER node
EXPOSE 8080
CMD ["node", "backend/dist/src/index.js"]
