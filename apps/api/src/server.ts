import { db } from "@oceanbrown/db";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { closeQueue } from "./queue.js";

const app = await buildApp();
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await closeQueue();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.port, host: "0.0.0.0" });
