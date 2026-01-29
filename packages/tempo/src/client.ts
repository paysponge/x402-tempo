import type { SchemeNetworkClient, PaymentRequirements, PaymentPayload } from "@x402/core/types";
import type { Address, Hex } from "./types";
import { encodeFunctionData } from "viem";
import { Abis } from "viem/tempo";
import type { TempoPaymentExtra } from "./types";
import {
  DEFAULT_GAS_LIMIT_CAP,
  DEFAULT_MAX_FEE_PER_GAS_CAP,
  DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP,
} from "./types";

export interface TempoSignerConfig {
  signTempoTransaction: (tx: TempoTransactionRequest) => Promise<string>;
  address: Address;
}

export interface TempoTransactionRequest {
  chainId: number;
  calls: Array<{
    to: Address;
    data: Hex;
    value: bigint;
  }>;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  validBefore?: number;
  validAfter?: number;
}

export class ExactTempoClientScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  private readonly signer: TempoSignerConfig;

  constructor(signer: TempoSignerConfig) {
    this.signer = signer;
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const chainId = parseInt(paymentRequirements.network.split(":")[1], 10);

    const now = Math.floor(Date.now() / 1000);
    const maxTimeout = paymentRequirements.maxTimeoutSeconds ?? 300;
    const validBefore = maxTimeout > 0 ? now + maxTimeout : undefined;
    const validAfter = undefined;

    const callData = encodeFunctionData({
      abi: Abis.tip20,
      functionName: "transfer",
      args: [paymentRequirements.payTo as Address, BigInt(paymentRequirements.amount)],
    }) as Hex;

    const extra = paymentRequirements.extra as unknown as TempoPaymentExtra | undefined;
    const gas = extra?.gasLimitMax ? BigInt(extra.gasLimitMax) : DEFAULT_GAS_LIMIT_CAP;
    const maxFeePerGas = extra?.maxFeePerGasMax
      ? BigInt(extra.maxFeePerGasMax)
      : DEFAULT_MAX_FEE_PER_GAS_CAP;
    const maxPriorityFeePerGas = extra?.maxPriorityFeePerGasMax
      ? BigInt(extra.maxPriorityFeePerGasMax)
      : DEFAULT_MAX_PRIORITY_FEE_PER_GAS_CAP;

    const txRequest: TempoTransactionRequest = {
      chainId,
      calls: [
        {
          to: paymentRequirements.asset as Address,
          data: callData,
          value: 0n,
        },
      ],
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      validBefore,
      validAfter,
    };

    const serializedTransaction = await this.signer.signTempoTransaction(txRequest);

    return {
      x402Version,
      payload: {
        serializedTransaction,
        transfer: {
          token: paymentRequirements.asset,
          from: this.signer.address,
          to: paymentRequirements.payTo,
          value: paymentRequirements.amount,
        },
      },
    };
  }
}
