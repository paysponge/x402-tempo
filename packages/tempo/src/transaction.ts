import { createClient, createPublicClient, defineChain, http, type Hash } from "viem";
import { tempoModerato } from "viem/chains";
import { Transaction } from "viem/tempo";
import { Secp256k1 } from "ox";
import { TxEnvelopeTempo } from "ox/tempo";
import type { Address, Hex, ParsedTempoTransaction } from "./types";
import { TRANSFER_SELECTOR, TEMPO_TX_TYPE_BYTE } from "./types";
import { logger } from "./logger";

// pathUSD token address on Tempo
const PATH_USD: Address = "0x20c0000000000000000000000000000000000000";

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
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { error: errorMsg, txPrefix: serializedTx.slice(0, 66) },
      "Failed to parse Tempo transaction",
    );
    return {
      valid: false,
      error: `Failed to parse transaction: ${errorMsg}`,
    };
  }
}

export async function submitSponsoredTransaction(
  serializedTx: string,
  rpcUrl: string,
  privateKey: Hex,
  chainId: number,
  senderAddress: Address,
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

    const chain = defineChain({ ...tempoModerato, id: chainId });
    const client = createClient({
      chain,
      transport: http(rpcUrl),
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const tx = Transaction.deserialize(serializedTx as `0x76${string}`);

    if (!tx.signature) {
      return { error: "Transaction missing sender signature" };
    }

    // Estimate gas if not provided in tx
    let gas = tx.gas;
    if (!gas) {
      try {
        const call = tx.calls[0];
        const estimated = await publicClient.estimateGas({
          account: senderAddress,
          to: call.to as Address,
          data: call.data as Hex,
          value: 0n,
        });
        gas = (estimated * 120n) / 100n; // 20% buffer
      } catch {
        gas = 100_000n; // fallback
      }
    }

    // Get fee estimates if not provided
    let maxFeePerGas = tx.maxFeePerGas;
    let maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    if (!maxFeePerGas || !maxPriorityFeePerGas) {
      try {
        const fees = await publicClient.estimateFeesPerGas();
        maxFeePerGas = maxFeePerGas ?? fees.maxFeePerGas;
        maxPriorityFeePerGas = maxPriorityFeePerGas ?? fees.maxPriorityFeePerGas;
      } catch {
        maxFeePerGas = maxFeePerGas ?? 1_000_000_000n; // 1 gwei fallback
        maxPriorityFeePerGas = maxPriorityFeePerGas ?? 1_000_000_000n;
      }
    }

    logger.info(
      {
        originalTx: serializedTx,
        parsed: {
          from: senderAddress,
          to: parsed.to,
          token: parsed.token,
          value: parsed.value?.toString(),
          chainId: parsed.chainId,
          gasLimit: parsed.gasLimit?.toString(),
          maxFeePerGas: parsed.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: parsed.maxPriorityFeePerGas?.toString(),
          validBefore: tx.validBefore,
          validAfter: tx.validAfter,
          hasSenderSignature: parsed.hasSenderSignature,
        },
        sponsorParams: {
          gas: gas?.toString(),
          maxFeePerGas: maxFeePerGas?.toString(),
          maxPriorityFeePerGas: maxPriorityFeePerGas?.toString(),
          feeToken: PATH_USD,
        },
      },
      "Preparing sponsored transaction",
    );

    // Use ox's TxEnvelopeTempo directly, following the e2e test pattern exactly.
    // 1. Deserialize with ox
    const txEnvelope = TxEnvelopeTempo.deserialize(serializedTx as `0x76${string}`);

    // 2. Create the fee payer transaction with feeToken added
    const transaction_feePayer = TxEnvelopeTempo.from({
      ...txEnvelope,
      feeToken: PATH_USD,
    });

    // 3. Compute fee payer sign payload
    const feePayerSignPayload = TxEnvelopeTempo.getFeePayerSignPayload(transaction_feePayer, {
      sender: senderAddress,
    });

    // 4. Sign with fee payer's private key
    const feePayerSignature = Secp256k1.sign({
      payload: feePayerSignPayload,
      privateKey,
    });

    // 5. Serialize with fee payer signature
    const signedTx = TxEnvelopeTempo.serialize(transaction_feePayer, {
      feePayerSignature,
    });

    logger.info({ signedTx }, "Submitting transaction to RPC");

    const hash = await client.request({
      method: "eth_sendRawTransaction",
      params: [signedTx],
    });

    return { hash: hash as Hash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";

    let errorType: string;
    let errorResult: { error: string };

    if (msg.includes("insufficient funds") || msg.includes("balance")) {
      errorType = "insufficient_balance";
      errorResult = { error: `Insufficient balance: ${msg}` };
    } else if (msg.includes("nonce")) {
      errorType = "nonce_error";
      errorResult = { error: `Nonce error: ${msg}` };
    } else if (msg.includes("signature") || msg.includes("invalid")) {
      errorType = "signature_error";
      errorResult = { error: `Signature error: ${msg}` };
    } else {
      errorType = "submission_error";
      errorResult = { error: `Failed to submit transaction: ${msg}` };
    }

    logger.error(
      { error: msg, errorType, chainId, txPrefix: serializedTx.slice(0, 66) },
      "Failed to submit sponsored transaction",
    );

    return errorResult;
  }
}

export function encodeTransferCall(to: Address, value: bigint): Hex {
  const toHex = to.slice(2).toLowerCase().padStart(64, "0");
  const valueHex = value.toString(16).padStart(64, "0");
  return `${TRANSFER_SELECTOR}${toHex}${valueHex}` as Hex;
}
