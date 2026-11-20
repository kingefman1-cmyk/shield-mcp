---
name: caelara-shield
description: Pre-execution guardrail for wallet actions. Before signing any approval, token route, perp or prediction order, NFT mint or raw transaction, screen it with Caelara Shield and show the risk to the user. Free, no key.
homepage: https://caelaralabs.com/shield/
metadata: { "openclaw": { "requires": { "bins": ["curl"] } } }
---

# Caelara Shield guardrail

Use this skill **before** you sign, approve or submit anything from a wallet, and whenever the user asks whether a transaction, approval or order is safe.

Caelara Shield screens the action and returns an **unsigned** payload. It never signs, never submits and never needs a private key. Heuristic screening — will miss attacks: "no findings" is not proof of safety.

## Call

```bash
curl -s https://shield.caelaralabs.com/v1/universal/screen-build \
  -H 'Content-Type: application/json' \
  -d '{"type":"<type>","strictBlock":false,"params":{...}}'
```

| type | params |
|---|---|
| `tx_guardrail` | `chainId` (1, 8453, 42161, 10, 137, 56), `to`, `data`, optional `value`, `from` |
| `token_route` | `fromChain`, `toChain?`, `tokenIn`, `tokenOut`, `amount` (smallest units), `slippageBps?`, `taker` (to build), `recipient` (EVM <-> Solana) |
| `perp_order` | `venue: "hyperliquid"`, `coin`, `isBuy`, `size`, `orderType?`, `limitPx?`, `user?`; or `venue: "gmx"` (fields: https://shield.caelaralabs.com/openapi.json) |
| `prediction_order` | `venue: "polymarket"`, `tokenId`, `side` (BUY/SELL), `price` (0-1), `size`, `maker` |
| `nft_action` | `venue: "zora"` or `venue: "seaport"` (fields: openapi.json) |

## Rules

1. **Always show the result before signing.** Show `riskLevel` and every entry in `flags` to the user before anything is signed.
2. **High risk needs explicit confirmation.** If `riskLevel` is `high`, do not proceed unless the user explicitly confirms after seeing the flags.
3. **Unattended runs use strict mode.** For treasury or unattended runs, send `"strictBlock": true`: a high-risk action then returns `policy_blocked` and nothing is built.
4. **Sign only what was screened.** Sign only the returned `unsignedPayload`, with the user's own wallet. Never paste a private key or seed phrase anywhere.
5. **Mention the fee.** `feeModel` describes any fee or referral. Tell the user when a fee applies (for example the 0.50% on token routes).
6. **Respect jurisdiction refusals.** `jurisdiction_restricted` means the venue does not allow orders from the user's location. Do not try to work around it.

## Alternative: MCP server

```json
{ "mcpServers": { "caelara-shield": { "command": "npx", "args": ["-y", "@caelaralabs/shield-mcp"] } } }
```

The tool is `shield_universal_action`, with the same `type`, `strictBlock` and `params`.
