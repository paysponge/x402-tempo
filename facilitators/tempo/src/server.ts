import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
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

export function createServer() {
  const { facilitator } = createFacilitator();

  const paymentPayloadSchema = t.Object({
    x402Version: t.Number(),
    resource: t.Object({
      url: t.String(),
      description: t.String(),
      mimeType: t.String(),
    }),
    accepted: t.Object({
      scheme: t.String(),
      network: t.String(),
      asset: t.String(),
      amount: t.String(),
      payTo: t.String(),
      maxTimeoutSeconds: t.Number(),
      extra: t.Record(t.String(), t.Unknown()),
    }),
    payload: t.Record(t.String(), t.Unknown()),
  });

  const paymentRequirementsSchema = t.Object({
    scheme: t.String(),
    network: t.String(),
    asset: t.String(),
    amount: t.String(),
    payTo: t.String(),
    maxTimeoutSeconds: t.Number(),
    extra: t.Record(t.String(), t.Unknown()),
  });

  const app = new Elysia()
    .use(
      cors({
        origin:
          config.corsAllowedOrigins === "*"
            ? true
            : config.corsAllowedOrigins.split(",").map((o) => o.trim()),
        methods: ["GET", "POST", "OPTIONS"],
        credentials: true,
      }),
    )
    .onRequest(({ request }) => {
      const url = new URL(request.url);
      logger.debug({ method: request.method, path: url.pathname }, "Request received");
    })
    .onAfterResponse(({ request, set }) => {
      const url = new URL(request.url);
      logger.debug({ method: request.method, path: url.pathname, status: set.status }, "Response sent");
    })

    // Health check
    .get("/health", () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      network: config.tempoNetworkId,
    }))

    // GET /supported
    .get("/supported", () => {
      return facilitator.getSupported();
    })

    // POST /verify
    .post(
      "/verify",
      async ({ body }) => {
        const result = await facilitator.verify(
          body.paymentPayload as unknown as PaymentPayload,
          body.paymentRequirements as unknown as PaymentRequirements,
        );
        return result;
      },
      {
        body: t.Object({
          paymentPayload: paymentPayloadSchema,
          paymentRequirements: paymentRequirementsSchema,
        }),
      },
    )

    // POST /settle
    .post(
      "/settle",
      async ({ body }) => {
        const result = await facilitator.settle(
          body.paymentPayload as unknown as PaymentPayload,
          body.paymentRequirements as unknown as PaymentRequirements,
        );
        return result;
      },
      {
        body: t.Object({
          paymentPayload: paymentPayloadSchema,
          paymentRequirements: paymentRequirementsSchema,
        }),
      },
    )

    // Error handling
    .onError(({ code, error, set, request }) => {
      const url = new URL(request.url);
      const errorMessage = error instanceof Error ? error.message : String(error);

      switch (code) {
        case "VALIDATION":
          logger.warn({ code, path: url.pathname, message: errorMessage }, "Validation error");
          set.status = 400;
          return { error: "Validation Error", message: errorMessage, statusCode: 400 };

        case "NOT_FOUND":
          set.status = 404;
          return { error: "Not Found", message: "Endpoint not found", statusCode: 404 };

        case "PARSE":
          logger.warn({ code, path: url.pathname, message: errorMessage }, "Parse error");
          set.status = 400;
          return { error: "Parse Error", message: "Invalid request body", statusCode: 400 };

        default:
          logger.error({ code, path: url.pathname, message: errorMessage }, "Unhandled error");
          set.status = 500;
          return {
            error: "Internal Server Error",
            message: config.environment === "development" ? errorMessage : "An unexpected error occurred",
            statusCode: 500,
          };
      }
    });

  return app;
}

export function startServer() {
  const app = createServer();

  app.listen(config.port, () => {
    logger.info(
      { host: config.host, port: config.port, environment: config.environment, network: config.tempoNetworkId },
      "x402 Tempo Facilitator started",
    );
  });

  return app;
}

export type App = ReturnType<typeof createServer>;
