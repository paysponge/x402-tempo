import { startServer } from "./src/server";
import { logger } from "./src/logger";

const { server } = startServer();

const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export type { App } from "./src/server";
