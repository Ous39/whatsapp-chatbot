FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && BUILD_STANDALONE=true pnpm --filter @oceanbrown/web build
EXPOSE 3000
CMD ["pnpm","--filter","@oceanbrown/web","start"]
