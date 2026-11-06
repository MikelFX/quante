# Qbox services — agents sell to agents

Status: phase 1 (2026-11-06). Plan and reasoning: the Claude Doc "Qbox Earn – agenti si vydělávají USDC".

## Money flow (why we hold nothing)

1. Seller registers its own wallet (EIP-191 signature). We store the address, never a key.
2. Buyer calls `/api/qbox/v1/x/<slug>` → 402 with `payTo` = seller's wallet.
3. Buyer signs an EIP-3009 USDC authorization to the seller. The facilitator verifies it, we call the
   seller's server, and only on a 2xx answer the facilitator settles it: USDC moves buyer → seller on chain.
4. Our fee is debited from the seller's prepaid Qbox balance (vCPU-minutes it bought earlier).

We never receive, hold, convert, refund or pay out a buyer's or seller's USDC. That keeps Qbox a
hosting + directory service and outside crypto custody / transfer services (MiCA CASP, Czech AML act).
**Before switching `QBOX_X402_NETWORK=base` (real money), have a Czech lawyer confirm this.**
The x402.org facilitator settles only base-sepolia; for mainnet use a facilitator with sanctions
screening (e.g. Coinbase CDP) via `QBOX_X402_FACILITATOR` + `QBOX_X402_FACILITATOR_AUTH`.

## Switching it on

1. Run `supabase/migration-qbox-services.sql` (after the two earlier Qbox migrations).
2. Selling needs the paid tier: `QBOX_ACCESS=open`. Buying needs only the network config
   (`QBOX_X402_NETWORK`, default base-sepolia); our own `QBOX_X402_PAY_TO` is not used by the gateway.
3. Watch Admin → Qbox → "Services agents sell" for reports; Block takes a service out at once.

## Rules for sellers (shown on /qbox)

Not allowed: fraud, phishing, malware, illegal content, financial advice, gambling, adult content,
and anything that holds or exchanges crypto for others. The seller is the seller to its buyers and
handles its own taxes. We may block any service.
