import { z } from "zod";
import type { Network } from "@x402/core/types";

const configSchema = z.object({
  port: z.coerce.number().default(3402),
  host: z.string().default("0.0.0.0"),
  environment: z.enum(["development", "staging", "production"]).default("development"),

  tempoRpcUrl: z.string().url().default("https://rpc.moderato.tempo.xyz"),
  tempoChainId: z.coerce.number().default(42431),
  tempoNetworkId: z.string().default("tempo:42431"),

  facilitatorPrivateKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid private key format"),

  supportedTokens: z
    .string()
    .default("0x20c0000000000000000000000000000000000000")
    .transform((s) => s.split(",").map((t) => t.trim().toLowerCase() as `0x${string}`)),

  corsAllowedOrigins: z.string().default("*"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse({
    port: process.env.PORT,
    host: process.env.HOST,
    environment: process.env.ENVIRONMENT,
    tempoRpcUrl: process.env.TEMPO_RPC_URL,
    tempoChainId: process.env.TEMPO_CHAIN_ID,
    tempoNetworkId: process.env.TEMPO_NETWORK_ID,
    facilitatorPrivateKey: process.env.FACILITATOR_PRIVATE_KEY,
    supportedTokens: process.env.SUPPORTED_TOKENS,
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
    logLevel: process.env.LOG_LEVEL,
  });

  if (!result.success) {
    console.error("Configuration validation failed:");
    console.error(result.error.format());
    throw new Error("Invalid configuration - check environment variables");
  }

  return result.data;
}

export const config = loadConfig();
