import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactTempoScheme } from "@x402/tempo";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { config } from "./config";
import { logger } from "./logger";

function createFacilitator() {
  const scheme = new ExactTempoScheme({
    rpcUrl: config.tempoRpcUrl,
    chainId: config.tempoChainId,
    networkId: config.tempoNetworkId as Network,
    privateKey: config.facilitatorPrivateKey as `0x${string}`,
    supportedTokens: config.supportedTokens,
  });

  const facilitator = new x402Facilitator();
  facilitator.register(config.tempoNetworkId as Network, scheme);
  return { facilitator, scheme };
}

const paymentPayloadSchema = z.object({
  x402Version: z.number(),
  resource: z.object({
    url: z.string(),
    description: z.string(),
    mimeType: z.string(),
  }),
  accepted: z.object({
    scheme: z.string(),
    network: z.string(),
    asset: z.string(),
    amount: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number(),
    extra: z.record(z.string(), z.unknown()),
  }),
  payload: z.record(z.string(), z.unknown()),
});

const paymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number(),
  extra: z.record(z.string(), z.unknown()),
});

const verifySettleBodySchema = z.object({
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema,
});

export function createServer() {
  const { facilitator } = createFacilitator();

  const app = new Hono();

  // CORS middleware
  const origins =
    config.corsAllowedOrigins === "*"
      ? "*"
      : config.corsAllowedOrigins.split(",").map((o) => o.trim());

  app.use(
    "*",
    cors({
      origin: origins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    }),
  );

  // Request logging middleware
  app.use("*", async (c, next) => {
    logger.info({ method: c.req.method, path: c.req.path }, "Request received");
    await next();
    logger.info({ method: c.req.method, path: c.req.path, status: c.res.status }, "Response sent");
  });

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      network: config.tempoNetworkId,
    });
  });

  // GET /supported
  app.get("/supported", (c) => {
    return c.json(facilitator.getSupported());
  });

  // POST /verify
  app.post("/verify", zValidator("json", verifySettleBodySchema), async (c) => {
    const body = c.req.valid("json");
    const result = await facilitator.verify(
      body.paymentPayload as unknown as PaymentPayload,
      body.paymentRequirements as unknown as PaymentRequirements,
    );
    return c.json(result);
  });

  // POST /settle
  app.post("/settle", zValidator("json", verifySettleBodySchema), async (c) => {
    const body = c.req.valid("json");
    const result = await facilitator.settle(
      body.paymentPayload as unknown as PaymentPayload,
      body.paymentRequirements as unknown as PaymentRequirements,
    );
    return c.json(result);
  });

  // Error handling
  app.onError((err, c) => {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check if it's a Zod validation error
    if (err.name === "ZodError" || err.message.includes("Validation")) {
      logger.warn({ path: c.req.path, message: errorMessage }, "Validation error");
      return c.json({ error: "Validation Error", message: errorMessage, statusCode: 400 }, 400);
    }

    logger.error({ path: c.req.path, message: errorMessage }, "Unhandled error");
    return c.json(
      {
        error: "Internal Server Error",
        message: config.environment === "development" ? errorMessage : "An unexpected error occurred",
        statusCode: 500,
      },
      500,
    );
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: "Not Found", message: "Endpoint not found", statusCode: 404 }, 404);
  });

  return app;
}

export function startServer() {
  const app = createServer();

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
  });

  logger.info(
    { host: config.host, port: config.port, environment: config.environment, network: config.tempoNetworkId },
    "x402 Tempo Facilitator started",
  );

  return { app, server };
}

export type App = ReturnType<typeof createServer>;
