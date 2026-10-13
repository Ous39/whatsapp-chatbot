FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @oceanbrown/db generate && pnpm --filter @oceanbrown/api build
CMD ["node","apps/api/dist/server.js"]
