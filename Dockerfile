# Single image for api + worker (JC-6): same build, different command per Fly app.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jobcrush/contracts --filter @jobcrush/api-client --filter @jobcrush/api build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
