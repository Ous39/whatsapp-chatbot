FROM node:22-alpine
# ffmpeg converts synthesized speech to Ogg/Opus so WhatsApp shows it as a voice note.
RUN corepack enable && apk add --no-cache ffmpeg
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @oceanbrown/db generate \
 && pnpm --filter @oceanbrown/worker build \
 && chown -R node:node /app
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/worker
CMD ["node","--import","tsx","dist/index.js"]
