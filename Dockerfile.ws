FROM node:24-alpine

ENV CI=true

RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

ENV DATABASE_URL="postgresql://postgres:build@127.0.0.1:5432/concord"
ENV DATABASE_DIRECT_URL="postgresql://postgres:build@127.0.0.1:5432/concord"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsdown.api.config.ts tsdown.ws.config.ts prisma.config.ts .npmrc ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm install --frozen-lockfile \
  && pnpm prisma generate \
  && pnpm exec tsdown --c tsdown.ws.config.ts

EXPOSE 8081

CMD ["node", "--enable-source-maps", "dist/ws/index.mjs", "--ws"]
