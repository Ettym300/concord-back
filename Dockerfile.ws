FROM node:22-alpine

RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsdown.api.config.ts tsdown.ws.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm install --frozen-lockfile \
  && pnpm prisma generate \
  && pnpm exec tsdown --c tsdown.ws.config.ts

EXPOSE 8081

CMD ["node", "--enable-source-maps", "dist/ws/index.mjs", "--ws"]
