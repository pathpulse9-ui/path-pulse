ARG NODE_IMAGE=node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

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
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps --chown=root:root /app /app
COPY --from=build --chown=root:root /app/packages/contract /app/packages/contract
COPY --from=build --chown=root:root /app/backend/dist /app/backend/dist
USER node
EXPOSE 8080
CMD ["node", "backend/dist/src/index.js"]
