FROM oven/bun:1.4.3 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY scripts ./scripts
COPY i18n ./i18n
COPY public ./public
COPY src ./src
COPY astro.config.mjs env.d.ts tsconfig.json ./

RUN bun run build

FROM oven/bun:1.4.3 AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/dist ./dist

EXPOSE 4321

CMD ["bun", "dist/server/entry.mjs"]
