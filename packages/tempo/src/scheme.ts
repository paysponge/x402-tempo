import type {
  SchemeNetworkFacilitator,
  SchemeNetworkServer,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  Price,
  Network,
  AssetAmount,
} from "@x402/core/types";
import { createPublicClient, http, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { parseTempoTransaction } from "./transaction";
import { submitSponsoredTransaction } from "./transaction";
import { TokenRegistry, DEFAULT_PATHUSD } from "./tokens";
import type { Address, Hex, ExactTempoSchemeConfig, TempoPaymentExtra } from "./types";
import {
  TEMPO_TESTNET_CHAIN_ID,
  TEMPO_TESTNET_NETWORK,
  DEFAULT_GAS_LIMIT_CAP,
  DEFAULT_MAX_FEE_PER_GAS_CAP,
  DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP,
} from "./types";
import { logger } from "./logger";

function verifyFail(reason: string, context?: Record<string, unknown>): VerifyResponse {
  logger.warn({ reason, ...context }, "Verification failed");
  return { isValid: false, invalidReason: reason };
}

function settleFail(reason: string, network: Network, context?: Record<string, unknown>): SettleResponse {
  logger.error({ reason, network, ...context }, "Settlement failed");
  return { success: false, errorReason: reason, transaction: "", network };
}

export class ExactTempoScheme implements SchemeNetworkFacilitator, SchemeNetworkServer {
  readonly scheme = "exact";
  readonly caipFamily = "tempo:*";

  private readonly rpcUrl: string;
  private readonly chainId: number;
  private readonly networkId: Network;
  private readonly privateKey: Hex;
  private readonly account: PrivateKeyAccount;
  private readonly tokenRegistry: TokenRegistry;
  private readonly publicClient: PublicClient;

  constructor(config: ExactTempoSchemeConfig) {
    this.rpcUrl = config.rpcUrl;
    this.chainId = config.chainId ?? TEMPO_TESTNET_CHAIN_ID;
    this.networkId = config.networkId ?? TEMPO_TESTNET_NETWORK;
    this.privateKey = config.privateKey;
    this.account = privateKeyToAccount(this.privateKey);
    this.tokenRegistry = new TokenRegistry(
      this.rpcUrl,
      config.supportedTokens ?? [DEFAULT_PATHUSD],
    );
    this.publicClient = createPublicClient({
      transport: http(this.rpcUrl),
    }) as PublicClient;
  }

  // --- SchemeNetworkFacilitator ---

  getExtra(_network: Network): Record<string, unknown> | undefined {
    return {
      feePayer: this.account.address,
      feeTokenHint: DEFAULT_PATHUSD,
      gasLimitMax: String(DEFAULT_GAS_LIMIT_CAP),
      maxFeePerGasMax: String(DEFAULT_MAX_FEE_PER_GAS_CAP),
      maxPriorityFeePerGasMax: String(DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP),
    };
  }

  getSigners(_network: string): string[] {
    return [this.account.address];
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const txPayload = payload.payload as {
      serializedTransaction?: string;
      transaction?: string;
      transfer?: { token: string; from: string; to: string; value: string };
    };

    const serializedTx = txPayload.serializedTransaction ?? txPayload.transaction;
    if (!serializedTx) {
      return verifyFail("Missing serializedTransaction in payload");
    }

    // 1. Network validation
    if (requirements.network !== this.networkId) {
      return verifyFail(`Expected network ${this.networkId}, got ${requirements.network}`);
    }

    // 2. Parse transaction
    const parsed = parseTempoTransaction(serializedTx);
    if (!parsed.valid) {
      return verifyFail(parsed.error || "Failed to parse Tempo transaction");
    }

    // 3. Chain ID
    if (parsed.chainId && parsed.chainId !== this.chainId) {
      return verifyFail(`Chain ID ${parsed.chainId} doesn't match ${this.chainId}`);
    }

    // 4. Token supported
    const token = parsed.token!;
    if (!this.tokenRegistry.isSupported(token)) {
      return verifyFail(`Token ${token} is not supported`);
    }

    // 5. Token matches asset requirement
    if (token !== requirements.asset.toLowerCase()) {
      return verifyFail("Transaction token does not match required asset");
    }

    // 6. Recipient matches
    if (parsed.to! !== requirements.payTo.toLowerCase()) {
      return verifyFail("Transaction recipient does not match payTo");
    }

    // 7. Amount check
    const requiredAmount = BigInt(requirements.amount);
    if (parsed.value! < requiredAmount) {
      return verifyFail(`Amount ${parsed.value} < required ${requiredAmount}`);
    }

    // 8. Fee payer safety
    const feePayerAddr = this.account.address.toLowerCase();
    const senderAddr = (parsed.from || txPayload.transfer?.from || "").toLowerCase();
    if (feePayerAddr === senderAddr) {
      return verifyFail("Fee payer cannot be the sender");
    }
    if (feePayerAddr === parsed.to!) {
      return verifyFail("Fee payer cannot be the transfer recipient");
    }
    if (feePayerAddr === token) {
      return verifyFail("Fee payer cannot be the token contract");
    }

    // 9. Timing validity
    const now = Math.floor(Date.now() / 1000);
    if (parsed.validBefore && parsed.validBefore !== 0 && now >= parsed.validBefore) {
      return verifyFail("Transaction has expired");
    }
    if (parsed.validAfter && parsed.validAfter !== 0 && now < parsed.validAfter) {
      return verifyFail("Transaction is not yet valid");
    }
    if (parsed.validBefore && parsed.validBefore !== 0) {
      const maxTimeout = requirements.maxTimeoutSeconds || 300;
      if (parsed.validBefore > now + maxTimeout + 60) {
        return verifyFail("validBefore too far in the future");
      }
    }

    // 10. Fee safety caps
    const extra = requirements.extra as unknown as TempoPaymentExtra | undefined;
    const gasLimitCap = extra?.gasLimitMax ? BigInt(extra.gasLimitMax) : DEFAULT_GAS_LIMIT_CAP;
    const maxFeeCap = extra?.maxFeePerGasMax ? BigInt(extra.maxFeePerGasMax) : DEFAULT_MAX_FEE_PER_GAS_CAP;
    const maxPriorityCap = extra?.maxPriorityFeePerGasMax ? BigInt(extra.maxPriorityFeePerGasMax) : DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP;

    if (parsed.gasLimit && parsed.gasLimit > gasLimitCap) {
      return verifyFail(`gas_limit ${parsed.gasLimit} exceeds cap ${gasLimitCap}`);
    }
    if (parsed.maxFeePerGas && parsed.maxFeePerGas > maxFeeCap) {
      return verifyFail(`max_fee_per_gas ${parsed.maxFeePerGas} exceeds cap ${maxFeeCap}`);
    }
    if (parsed.maxPriorityFeePerGas && parsed.maxPriorityFeePerGas > maxPriorityCap) {
      return verifyFail(`max_priority_fee_per_gas ${parsed.maxPriorityFeePerGas} exceeds cap ${maxPriorityCap}`);
    }

    // 11. Sender signature
    if (!parsed.hasSenderSignature) {
      return verifyFail("Transaction is missing sender signature");
    }

    // 12. Balance check
    const payer = parsed.from || txPayload.transfer?.from;
    if (!payer) {
      return verifyFail("Cannot determine sender address");
    }

    const balance = await this.tokenRegistry.getBalance(token, payer);
    if (balance < parsed.value!) {
      return verifyFail(`Balance ${balance} < required ${parsed.value}`);
    }

    return { isValid: true, payer };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    logger.info({ network: this.networkId, amount: requirements.amount }, "Starting settlement");

    // Re-verify before settling
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return settleFail(verifyResult.invalidReason || "Verification failed", this.networkId, {
        step: "verification",
      });
    }

    const txPayload = payload.payload as {
      serializedTransaction?: string;
      transaction?: string;
      transfer?: { from: string };
    };
    const serializedTx = (txPayload.serializedTransaction ?? txPayload.transaction)!;

    const result = await submitSponsoredTransaction(
      serializedTx,
      this.rpcUrl,
      this.privateKey,
      this.chainId,
      verifyResult.payer! as `0x${string}`,
    );

    if ("error" in result) {
      return settleFail(result.error, this.networkId, {
        step: "submission",
        payer: verifyResult.payer,
      });
    }

    logger.info({ hash: result.hash, network: this.networkId }, "Transaction submitted, waiting for confirmation");

    // Wait for confirmation
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: result.hash,
        confirmations: 1,
      });
      if (receipt.status === "reverted") {
        logger.error(
          { hash: result.hash, network: this.networkId },
          "Transaction reverted on-chain"
        );
        return {
          success: false,
          errorReason: `Transaction ${result.hash} reverted`,
          transaction: result.hash,
          network: this.networkId,
        };
      }
    } catch (error) {
      logger.warn(
        { hash: result.hash, error: error instanceof Error ? error.message : "Unknown error" },
        "Timeout waiting for confirmation - transaction may still succeed"
      );
    }

    const payer = verifyResult.payer || txPayload.transfer?.from || "";
    logger.info(
      { hash: result.hash, network: this.networkId, payer },
      "Settlement completed successfully"
    );
    return {
      success: true,
      transaction: result.hash,
      network: this.networkId,
      payer,
    };
  }

  // --- SchemeNetworkServer ---

  async parsePrice(price: Price, _network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && "amount" in price && "asset" in price) {
      return price;
    }

    const numericAmount = typeof price === "string" ? parseFloat(price.replace(/[^0-9.]/g, "")) : price;
    const amountInSmallestUnit = Math.round(numericAmount * 1_000_000);

    return {
      amount: String(amountInSmallestUnit),
      asset: DEFAULT_PATHUSD,
    };
  }

  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: { x402Version: number; scheme: string; network: Network; extra?: Record<string, unknown> },
    _facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    return {
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        feePayer: this.account.address,
        feeTokenHint: DEFAULT_PATHUSD,
        gasLimitMax: String(DEFAULT_GAS_LIMIT_CAP),
        maxFeePerGasMax: String(DEFAULT_MAX_FEE_PER_GAS_CAP),
        maxPriorityFeePerGasMax: String(DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP),
        ...(supportedKind.extra || {}),
      },
    };
  }
}
