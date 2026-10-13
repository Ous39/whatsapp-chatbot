FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @oceanbrown/db generate \
 && pnpm --filter @oceanbrown/api build \
 && chown -R node:node /app
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
EXPOSE 4000
# Workspace packages ship TypeScript sources, so the compiled entrypoint runs with the tsx loader.
CMD ["node","--import","tsx","dist/server.js"]
