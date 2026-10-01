# Single image for api + worker (JC-6): same build, different command per Fly app.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jobcrush/contracts --filter @jobcrush/api-client --filter @jobcrush/api build
# qa-main.ts (apps/api/src) is a QA-only fake-model entry, never CMD'd here — but tsc has no
# per-file exclude that wouldn't also drop it from the CI build that needs it, so prune the compiled
# output post-build instead: unreachable-by-CMD is not the same guarantee as absent-from-the-image.
RUN rm -f apps/api/dist/qa-main.js

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# #312: the API prints the CV itself (documentMaker.ts) — chrome-headless-shell plus HAND-PICKED
# apt deps, never `playwright install --with-deps`, which drags in ~282MB of X/Mesa/LLVM/CJK a
# headless PDF renderer never touches (measured, docs/research/pdf-in-container.md). The lib list
# is playwright-core's own debian12-x64 chromium set (lib/coreBundle.js nativeDeps), verbatim.
# The fonts are load-bearing, not cosmetic: the CV asks for Calibri/'Segoe UI'/Arial and this base
# image ships no fonts at all — page count is a pure function of font metrics, so Carlito (Calibri
# metrics) and Liberation (Arial metrics) are what make the two-page measurement mean what it says.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 \
    libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    fonts-crosextra-carlito fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists/*
# Puppeteer's own Dockerfile: "important for chrome-headless-shell".
ENV LANG=en_US.UTF-8
# One fixed, non-$HOME-dependent home for the browser, shared by install (below) and launch.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
COPY --from=build /app ./
# The shell only (114MB download / 260MB on disk) — plain `install chromium` fetches BOTH the full
# browser and the shell (638MB on disk) because both are installByDefault in the registry.
RUN node apps/api/node_modules/playwright-core/cli.js install chromium-headless-shell
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
