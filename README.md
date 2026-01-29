# x402-tempo

x402 payment scheme implementation for the Tempo blockchain network.

## Overview

This monorepo provides the tools to integrate Tempo blockchain with the [x402 payment protocol](https://github.com/coinbase/x402). It includes:

- **@x402/tempo** - Client and server-side scheme implementation for creating and verifying Tempo payments
- **@x402/facilitator-tempo** - Ready-to-run facilitator server for processing x402 payments on Tempo

## Packages

### `packages/tempo` (@x402/tempo)

Core library providing:

- `ExactTempoScheme` - Server-side scheme for verifying and settling payments
- `ExactTempoClientScheme` - Client-side scheme for creating payment payloads
- Token registry and utilities for TIP-20 tokens
- Transaction parsing and submission helpers

### `facilitators/tempo` (@x402/facilitator-tempo)

A Hono-based HTTP server that acts as an x402 facilitator:

- `/health` - Health check endpoint
- `/supported` - List supported networks and tokens
- `/verify` - Verify a payment payload
- `/settle` - Settle a payment on-chain

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.1+
- Access to a Tempo RPC endpoint

### Installation

```bash
bun install
```

### Running the Facilitator

```bash
cd facilitators/tempo
cp .env.example .env  # Configure your environment
bun dev
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TEMPO_RPC_URL` | Tempo blockchain RPC endpoint |
| `TEMPO_CHAIN_ID` | Chain ID (default: Tempo testnet) |
| `FACILITATOR_PRIVATE_KEY` | Private key for fee sponsorship |
| `PORT` | Server port (default: 3000) |

## Usage

### Client-Side (Creating Payments)

```typescript
import { ExactTempoClientScheme } from "@x402/tempo";

const scheme = new ExactTempoClientScheme({
  signTempoTransaction: async (tx) => {
    // Sign with your wallet
    return signedTransaction;
  },
  address: "0x...",
});

const payload = await scheme.createPaymentPayload(1, paymentRequirements);
```

### Server-Side (Verifying/Settling)

```typescript
import { ExactTempoScheme } from "@x402/tempo";
import { x402Facilitator } from "@x402/core/facilitator";

const scheme = new ExactTempoScheme({
  rpcUrl: "https://rpc.tempo.network",
  chainId: 123456,
  networkId: "tempo:123456",
  privateKey: "0x...",
  supportedTokens: ["0x..."], // TIP-20 token addresses
});

const facilitator = new x402Facilitator();
facilitator.register("tempo:123456", scheme);

// Verify payment
const result = await facilitator.verify(paymentPayload, paymentRequirements);

// Settle payment
const settlement = await facilitator.settle(paymentPayload, paymentRequirements);
```

## Development

```bash
# Type checking
bun run typecheck

# Run facilitator in dev mode with hot reload
cd facilitators/tempo && bun dev
```

## License

MIT
