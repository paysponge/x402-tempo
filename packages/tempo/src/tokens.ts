import { createPublicClient, http, formatUnits, parseUnits, type PublicClient } from "viem";
import type { Address, SupportedTokenInfo } from "./types";

export const TIP20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const KNOWN_TOKENS: Record<string, Omit<SupportedTokenInfo, "address">> = {
  "0x20c0000000000000000000000000000000000000": {
    symbol: "pathUSD",
    name: "pathUSD",
    decimals: 6,
  },
};

export const DEFAULT_PATHUSD: Address = "0x20c0000000000000000000000000000000000000";

export class TokenRegistry {
  private cache: Map<string, SupportedTokenInfo> = new Map();
  private client: PublicClient;
  private supportedTokens: Set<string>;

  constructor(rpcUrl: string, supportedTokens: Address[]) {
    this.client = createPublicClient({
      transport: http(rpcUrl),
    }) as PublicClient;
    this.supportedTokens = new Set(
      supportedTokens.map((t) => t.toLowerCase())
    );
  }

  isSupported(tokenAddress: string): boolean {
    return this.supportedTokens.has(tokenAddress.toLowerCase());
  }

  async getTokenInfo(tokenAddress: string): Promise<SupportedTokenInfo | null> {
    const normalized = tokenAddress.toLowerCase() as Address;
    if (!this.isSupported(normalized)) return null;

    if (this.cache.has(normalized)) {
      return this.cache.get(normalized)!;
    }

    const known = KNOWN_TOKENS[normalized];
    if (known) {
      const info: SupportedTokenInfo = { address: normalized, ...known };
      this.cache.set(normalized, info);
      return info;
    }

    try {
      const [name, symbol, decimals] = await Promise.all([
        this.client.readContract({ address: normalized, abi: TIP20_ABI, functionName: "name" }),
        this.client.readContract({ address: normalized, abi: TIP20_ABI, functionName: "symbol" }),
        this.client.readContract({ address: normalized, abi: TIP20_ABI, functionName: "decimals" }),
      ]);
      const info: SupportedTokenInfo = {
        address: normalized,
        name: name as string,
        symbol: symbol as string,
        decimals: decimals as number,
      };
      this.cache.set(normalized, info);
      return info;
    } catch {
      return null;
    }
  }

  async getAllSupportedTokens(): Promise<SupportedTokenInfo[]> {
    const tokens: SupportedTokenInfo[] = [];
    for (const address of this.supportedTokens) {
      const info = await this.getTokenInfo(address);
      if (info) tokens.push(info);
    }
    return tokens;
  }

  async getBalance(tokenAddress: string, account: string): Promise<bigint> {
    const client = this.client;
    const balance = await client.readContract({
      address: tokenAddress.toLowerCase() as Address,
      abi: TIP20_ABI,
      functionName: "balanceOf",
      args: [account as Address],
    });
    return balance as bigint;
  }
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals);
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}
