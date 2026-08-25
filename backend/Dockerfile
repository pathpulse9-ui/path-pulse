FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json packages/contract/
COPY backend/package.json backend/
COPY web/package.json web/
RUN pnpm install --filter @pathpulse/backend... --frozen-lockfile
COPY packages/contract packages/contract
COPY backend backend
RUN pnpm --filter @pathpulse/backend build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app /app
EXPOSE 8080
CMD ["node", "backend/dist/src/index.js"]
