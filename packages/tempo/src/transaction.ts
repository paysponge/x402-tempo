import { createClient, http, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Transaction } from "viem/tempo";
import { signTransaction } from "viem/actions";
import type { Address, Hex, ParsedTempoTransaction } from "./types";
import { TRANSFER_SELECTOR, TEMPO_TX_TYPE_BYTE } from "./types";

export function parseTempoTransaction(serializedTx: string): ParsedTempoTransaction {
  try {
    if (!serializedTx.startsWith(TEMPO_TX_TYPE_BYTE)) {
      return { valid: false, error: "Invalid transaction type. Expected Tempo transaction (0x76)" };
    }

    const tx = Transaction.deserialize(serializedTx as `0x76${string}`);
    const from = (tx as any).from as Address | undefined;

    if (!tx.calls || tx.calls.length === 0) {
      return { valid: false, error: "Transaction has no calls" };
    }

    if (tx.calls.length > 1) {
      return {
        valid: false,
        error: "Transaction has multiple calls. Expected single token transfer",
      };
    }

    const call = tx.calls[0];

    if (!call.data || !call.data.startsWith(TRANSFER_SELECTOR)) {
      return {
        valid: false,
        error: "Call is not a token transfer. Expected transfer(address,uint256)",
      };
    }

    // Validate call data length: 4 byte selector + 32 byte address + 32 byte uint256 = 68 bytes = 136 hex chars + 2 for 0x
    const dataWithout0x = call.data.slice(2);
    if (dataWithout0x.length !== 136) {
      return {
        valid: false,
        error: `Invalid call data length. Expected 68 bytes, got ${dataWithout0x.length / 2}`,
      };
    }

    // Validate call value is 0
    if (call.value && call.value !== 0n) {
      return { valid: false, error: "Call value must be 0 for token transfers" };
    }

    const token = call.to as Address;
    const toParam = ("0x" + dataWithout0x.slice(8 + 24, 8 + 64)) as Address;
    const valueParam = BigInt("0x" + dataWithout0x.slice(8 + 64, 8 + 128));
    const hasSenderSignature = !!tx.signature;

    return {
      valid: true,
      from,
      to: toParam.toLowerCase() as Address,
      token: token.toLowerCase() as Address,
      value: valueParam,
      validBefore: tx.validBefore,
      validAfter: tx.validAfter,
      chainId: tx.chainId,
      gasLimit: tx.gas != null ? BigInt(tx.gas) : undefined,
      maxFeePerGas: tx.maxFeePerGas != null ? BigInt(tx.maxFeePerGas) : undefined,
      maxPriorityFeePerGas:
        tx.maxPriorityFeePerGas != null ? BigInt(tx.maxPriorityFeePerGas) : undefined,
      hasSenderSignature,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to parse transaction: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function submitSponsoredTransaction(
  serializedTx: string,
  rpcUrl: string,
  privateKey: Hex,
  chainId: number,
): Promise<{ hash: Hash } | { error: string }> {
  try {
    const parsed = parseTempoTransaction(serializedTx);
    if (!parsed.valid) {
      return { error: parsed.error || "Invalid transaction" };
    }

    if (parsed.chainId && parsed.chainId !== chainId) {
      return { error: `Wrong chain ID. Expected ${chainId}, got ${parsed.chainId}` };
    }

    if (!parsed.hasSenderSignature) {
      return { error: "Transaction must have sender signature" };
    }

    const client = createClient({
      transport: http(rpcUrl),
    });

    const tx = Transaction.deserialize(serializedTx as `0x76${string}`);

    if (!tx.signature) {
      return { error: "Transaction missing sender signature" };
    }

    const feePayerAccount = privateKeyToAccount(privateKey);
    const signedTx = await signTransaction(client, {
      ...tx,
      account: feePayerAccount,
      // @ts-expect-error tempo fee payer param
      feePayer: feePayerAccount,
    });

    const hash = await client.request({
      method: "eth_sendRawTransaction",
      params: [signedTx],
    });

    return { hash: hash as Hash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";

    if (msg.includes("insufficient funds") || msg.includes("balance")) {
      return { error: `Insufficient balance: ${msg}` };
    }
    if (msg.includes("nonce")) {
      return { error: `Nonce error: ${msg}` };
    }
    if (msg.includes("signature") || msg.includes("invalid")) {
      return { error: `Signature error: ${msg}` };
    }
    return { error: `Failed to submit transaction: ${msg}` };
  }
}

export function encodeTransferCall(to: Address, value: bigint): Hex {
  const toHex = to.slice(2).toLowerCase().padStart(64, "0");
  const valueHex = value.toString(16).padStart(64, "0");
  return `${TRANSFER_SELECTOR}${toHex}${valueHex}` as Hex;
}
