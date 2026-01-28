import { startServer } from "./src/server";
import { logger } from "./src/logger";

const app = startServer();

const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export type { App } from "./src/server";
