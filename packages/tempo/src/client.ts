import type {
  SchemeNetworkClient,
  PaymentRequirements,
  PaymentPayload,
} from "@x402/core/types";
import type { Address, Hex, TempoPaymentExtra } from "./types";
import { encodeTransferCall } from "./transaction";

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
  validBefore: number;
  validAfter: number;
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
    const maxTimeout = paymentRequirements.maxTimeoutSeconds || 300;
    const validBefore = now + maxTimeout;
    const validAfter = 0;

    const callData = encodeTransferCall(
      paymentRequirements.payTo as Address,
      BigInt(paymentRequirements.amount),
    );

    const txRequest: TempoTransactionRequest = {
      chainId,
      calls: [
        {
          to: paymentRequirements.asset as Address,
          data: callData,
          value: 0n,
        },
      ],
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
