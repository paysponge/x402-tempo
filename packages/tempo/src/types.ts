import type { Network } from "@x402/core/types";

export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Hex = `0x${string}`;

export const TEMPO_TESTNET_CHAIN_ID = 42429;
export const TEMPO_TESTNET_NETWORK: Network = "tempo:42429";
export const TEMPO_TX_TYPE_BYTE = "0x76";
export const TRANSFER_SELECTOR = "0xa9059cbb";
export const FEE_PAYER_DOMAIN_BYTE = "0x78";

export const DEFAULT_GAS_LIMIT_CAP = 120_000n;
export const DEFAULT_MAX_FEE_PER_GAS_CAP = 2_000_000_000n;
export const DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP = 2_000_000_000n;

export interface TempoPaymentExtra {
  feePayer: string;
  feeTokenHint?: string;
  gasLimitMax?: string;
  maxFeePerGasMax?: string;
  maxPriorityFeePerGasMax?: string;
}

export interface ParsedTempoTransaction {
  valid: boolean;
  from?: Address;
  to?: Address;
  token?: Address;
  value?: bigint;
  validBefore?: number;
  validAfter?: number;
  chainId?: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  hasSenderSignature?: boolean;
  error?: string;
}

export interface SupportedTokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export interface ExactTempoSchemeConfig {
  rpcUrl: string;
  chainId?: number;
  networkId?: Network;
  privateKey: Hex;
  supportedTokens?: Address[];
}
