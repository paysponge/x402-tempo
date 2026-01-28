# Exact Payment Scheme for Tempo (`exact`)

This document specifies a Tempo-native `exact` payment scheme for the x402 protocol.
The scheme uses Tempo's fee sponsorship model (dual signatures) instead of permit-style
authorizations.

## Scheme Name

`exact`

## Network

`tempo:<chainId>`

## Protocol Flow (Client-Driven, Sponsored)

1. **Client** requests a protected resource from the **Resource Server**.
2. **Resource Server** responds with a 402 and `PaymentRequirements`. The `extra` field MUST
   include a `feePayer` address when sponsorship is required.
3. **Client** builds a Tempo Transaction (`type 0x76`) that transfers `amount` of `asset`
   to `payTo`. It MUST set `fee_payer_signature` as a placeholder (sponsored flow), and
   SHOULD leave `fee_token` empty so the fee payer can select a token.
4. **Client** signs the Tempo Transaction (sender signature) and serializes it.
5. **Client** sends a new request with `PaymentPayload` containing the serialized
   sender-signed transaction.
6. **Resource Server** forwards `PaymentPayload` and `PaymentRequirements` to the
   **Facilitator** `/verify` endpoint.
7. **Facilitator** validates the transaction against the requirements and safety rules.
8. **Facilitator** chooses a `fee_token` (if empty), signs the fee-payer domain, inserts
   `fee_payer_signature`, and submits the fully signed transaction.
9. **Facilitator** returns a `SettlementResponse` to the **Resource Server**.
10. **Resource Server** grants access to the **Client**.

## `PaymentRequirements` for `exact` on Tempo

In addition to standard x402 fields, the Tempo `exact` scheme requires the following
inside the `extra` field:

```json
{
  "scheme": "exact",
  "network": "tempo:42431",
  "amount": "1000000",
  "asset": "0xTokenAddress",
  "payTo": "0xMerchantAddress",
  "maxTimeoutSeconds": 60,
  "extra": {
    "feePayer": "0xFacilitatorAddress",
    "feeTokenHint": "0xPreferredFeeToken",
    "gasLimitMax": "120000",
    "maxFeePerGasMax": "2000000000",
    "maxPriorityFeePerGasMax": "2000000000",
    "nonceKey": "0"
  }
}
```

**Field notes:**

- `asset`: TIP-20 token contract address.
- `feePayer` (**required for sponsored flow**): address that will pay fees.
- `feeTokenHint` (optional): preferred fee token, overrideable by fee payer.
- `gasLimitMax`, `maxFeePerGasMax`, `maxPriorityFeePerGasMax` (optional): caps to protect the fee payer.
- `nonceKey` (optional): Tempo nonce key; default `0` if omitted.

## `PaymentPayload` `payload` Field

The `payload` field contains the sender-signed Tempo Transaction.

```json
{
  "transaction": "0x76f8..."
}
```

Full `PaymentPayload` object:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://example.com/weather",
    "description": "Access to protected content",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "tempo:42431",
    "amount": "1000000",
    "asset": "0xTokenAddress",
    "payTo": "0xMerchantAddress",
    "maxTimeoutSeconds": 60,
    "extra": {
      "feePayer": "0xFacilitatorAddress",
      "feeTokenHint": "0xPreferredFeeToken",
      "gasLimitMax": "120000",
      "maxFeePerGasMax": "2000000000",
      "maxPriorityFeePerGasMax": "2000000000",
      "nonceKey": "0"
    }
  },
  "payload": {
    "transaction": "0x76f8..."
  }
}
```

### Tempo Transaction Requirements (Sender-Signed)

The `transaction` MUST be a serialized Tempo Transaction (type `0x76`) whose **sender signature**
is computed with the fee payer placeholder rules:

- When `fee_payer_signature` is present (sponsored flow), the sender signature MUST be
  computed with:
  - `fee_token` encoded as empty (`0x80`)
  - `fee_payer_signature` encoded as `0x00` placeholder
- This allows the fee payer to choose `fee_token` later without invalidating the sender signature.

The fee payer signature MUST be computed in the fee payer domain (magic byte `0x78`) and
MUST commit to the sender address and the chosen `fee_token`.

## `SettlementResponse`

```json
{
  "success": true,
  "transaction": "0xTransactionHash",
  "network": "tempo:42431",
  "payer": "0xFacilitatorAddress"
}
```

## Facilitator Verification Rules (MUST)

Facilitators MUST enforce all of the following:

1. **Transaction type & chain**
   - `transaction` MUST decode to a Tempo Transaction (`type 0x76`).
   - `chain_id` MUST match the `PaymentRequirements.network` chain.

2. **Sponsored intent**
   - Sender signature MUST be valid.
   - `fee_payer_signature` MUST be present as a placeholder (`0x00`) in the sender-signed
     transaction.
   - `fee_token` MUST be empty in the sender-signed transaction (so fee payer can select).

3. **Call structure**
   - `calls.length` MUST equal `1`.
   - `calls[0].to` MUST equal `asset`.
   - `calls[0].value` MUST be `0`.
   - `calls[0].input` MUST decode to `transfer(payTo, amount)` on TIP-20.

4. **Amount & destination**
   - Transfer amount MUST equal `PaymentRequirements.amount` exactly.
   - Transfer destination MUST equal `PaymentRequirements.payTo`.

5. **Validity window**
   - `valid_before` MUST be set and MUST be <= (now + `maxTimeoutSeconds`).
   - `valid_after` MUST be <= current time (or omitted/0).

6. **Fee safety caps**
   - `gas_limit`, `max_fee_per_gas`, and `max_priority_fee_per_gas` MUST be <= configured caps.
   - If caps are provided in `extra`, use those; otherwise use facilitator defaults.

7. **Fee token selection**
   - Fee payer MUST choose a valid TIP-20 fee token with sufficient balance.
   - If `feeTokenHint` is provided, facilitator SHOULD use it if policy allows.

8. **Settlement integrity**
   - Fee payer MUST sign the fee payer domain (`0x78`) over the full transaction with the
     selected `fee_token`.
   - The submitted transaction MUST only differ from the sender-signed version by
     `fee_token` and `fee_payer_signature`.

Implementations MAY enforce stricter limits (e.g., lower fee caps) but MUST NOT relax
the above constraints.

## Optional Extensions (Non-Normative)

- **Batch calls**: Allow multiple TIP-20 transfers in a single Tempo transaction
  (requires expanded verification rules).
- **TransferWithMemo**: Permit `transferWithMemo` if memo binding to the resource is needed.
- **Nonce key policies**: Use dedicated `nonce_key` ranges for x402 to improve parallelism
  and replay isolation.
