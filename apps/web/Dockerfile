FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
# NEXT_PUBLIC_* values are inlined at build time, so the API URL must be a build argument.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile && pnpm --filter @oceanbrown/web build && chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["pnpm","--filter","@oceanbrown/web","start"]
