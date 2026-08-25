FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json packages/contract/
COPY backend/package.json backend/
COPY web/package.json web/
RUN pnpm install --filter web... --frozen-lockfile
COPY packages/contract packages/contract
COPY web web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
RUN pnpm --filter web build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY --from=build /app /app
EXPOSE 8080
WORKDIR /app/web
CMD ["pnpm","start","-p","8080"]
