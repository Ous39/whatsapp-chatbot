FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @oceanbrown/db generate && pnpm --filter @oceanbrown/worker build
CMD ["node","apps/worker/dist/index.js"]
