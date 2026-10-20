ARG NODE_IMAGE=node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json packages/contract/
COPY backend/package.json backend/
COPY web/package.json web/

FROM base AS deps
RUN pnpm install --filter web... --frozen-lockfile --prod

FROM base AS build
RUN pnpm install --filter web... --frozen-lockfile
COPY packages/contract packages/contract
COPY web web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_STELLAR_NETWORK=testnet
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_STELLAR_NETWORK=$NEXT_PUBLIC_STELLAR_NETWORK
RUN pnpm --filter web build

FROM ${NODE_IMAGE}
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps --chown=root:root /app /app
COPY --from=build --chown=root:root /app/packages/contract /app/packages/contract
COPY --from=build --chown=root:root /app/web/public /app/web/public
COPY --from=build --chown=root:root /app/web/next.config.ts /app/web/next.config.ts
COPY --from=build --chown=node:node /app/web/.next /app/web/.next
USER node
EXPOSE 8080
WORKDIR /app/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "8080"]
