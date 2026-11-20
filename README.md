# @caelaralabs/shield-mcp

**Caelara Shield: Pre-Execution Security & Universal Guardrail MCP Server.**

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI agent check what it is about to do before anything is signed or sent. It screens:

- prompts and model outputs,
- outbound fetches,
- tokens, raw calldata and token approvals,
- wallet actions on several venues.

For wallet actions it returns an **unsigned** payload for the human or wallet to review and sign. It never holds keys, never signs and never submits.

Plain Node ESM, zero runtime dependencies, Node 18 or newer.

```
npx -y @caelaralabs/shield-mcp
```

Heuristic screening — will miss attacks. No findings is not proof of safety.

## Tools

| Tool | What it checks | Route | Price |
|---|---|---|---|
| `shield_universal_action` | Any wallet action: screen, then build an unsigned payload (see below) | `POST /v1/universal/screen-build` | free, no key |
| `shield_scan_prompt` | Untrusted input before it reaches a model: injection, hidden characters, PII, secrets | `POST /v1/shield/prompt` | 0.015 USDC |
| `shield_validate_output` | Model output before it is used: leakage, exfiltration links, active content, shell patterns | `POST /v1/shield/output` | 0.015 USDC |
| `shield_proxy_fetch` | An https fetch through an SSRF-guarded proxy, with the body scanned | `GET /v1/proxy/_?url=...` | 0.025 USDC |
| `shield_audit_token` | A token, a broadcast transaction hash, or a destination address (poisoning lookalikes) | `POST /v1/shield/tx` | 0.050 USDC |
| `shield_route_quote` | A token route: screened quote across chains | `POST /v1/route/quote` | free, no key |
| `shield_safe_swap` | A token route: screened, unsigned transactions (tool name kept for compatibility) | `POST /v1/route/build` | free, no key |

## The universal guardrail

`shield_universal_action` takes `{ type, strictBlock?, params }` and always answers in one shape:

```json
{
  "ok": true,
  "type": "tx_guardrail",
  "venue": "evm",
  "riskLevel": "high",
  "flags": ["approval:unlimited: Grants an unlimited allowance ..."],
  "disclosure": "Heuristic screening — will miss attacks",
  "feeModel": { "kind": "none" },
  "unsignedPayload": { "kind": "evm_transaction", "chainId": 8453, "to": "0x...", "data": "0x..." },
  "policy": { "strictBlock": false }
}
```

**`riskLevel`** is `low`, `medium` or `high`. `flags` explain why.

**`strictBlock`** sets the risk policy:
- **`false` (default):** the action is risk-labelled and the payload is still built. An agent must show `riskLevel` and `flags` to the user and get explicit confirmation before anything is signed.
- **`true`:** `riskLevel: high` is refused with `policy_blocked` (HTTP 422), and no payload is built. Use it for treasuries and unattended agents.

| `type` | What it does | Fee model |
|---|---|---|
| `tx_guardrail` | Decodes arbitrary EVM calldata before signing. Flags unlimited or EOA-spender approvals, `setApprovalForAll`, transfers to the zero address or the token contract, calldata sent to an address with no code, and unrecognised calls. Screens the token involved. | none (screening only) |
| `token_route` | Screens both tokens, then quotes or builds a token route on Solana, Ethereum, Base, Arbitrum, Optimism, Polygon and BNB, including EVM <-> Solana. Pass `taker` to build. Pump.fun coins still on their bonding curve are screened (reserves, curve completion, holder and creator concentration) and built with the v3 curve instructions; `venue: "pumpfun"` forces that path. | 0.50% integrator fee, shown in the quote |
| `perp_order` | `venue: "hyperliquid"`: screens the market (delisting, volume, mark vs oracle, fat-finger price) and builds the order action. `venue: "gmx"`: screens the GMX v2 market on Arbitrum (liquidity, leverage) and builds the order transactions. | Hyperliquid builder code (10 bps, once activated); GMX UI fee (once activated) |
| `prediction_order` | `venue: "polymarket"`: screens the market (open, accepting orders, liquidity, tick and minimum size, price vs market) and builds the CLOB V2 order for EIP-712 signing. | Polymarket builder code (once registered) |
| `nft_action` | `venue: "zora"`: screens a Zora 1155 mint (sale window, contract verification) and builds the mint. `venue: "seaport"`: screens a signed Seaport listing (expiry, cancelled or filled, collection) and builds the fill. | Zora mint referral; Seaport fulfiller tip (50 bps, paid by the buyer) |

**Where fees go:** fee and referral recipients are configured server-side and are not published. They appear only inside the unsigned payload, where your wallet shows them before you sign.

**Derivatives are geofenced:** `perp_order` and `prediction_order` are refused (`jurisdiction_restricted`) wherever the venue's terms bar order placement, including the United States.

Field lists for every `params` shape: `https://shield.caelaralabs.com/openapi.json`. The per-venue REST routes take the same params at the top level:
- `/v1/hyperliquid/screen-order`
- `/v1/gmx/screen-order`
- `/v1/polymarket/screen-order`
- `/v1/nft/screen-build`

Example (check an approval before signing it):

```json
{ "type": "tx_guardrail", "strictBlock": true, "params": { "chainId": 8453, "to": "<token>", "data": "0x095ea7b3...", "from": "<your wallet>" } }
```

## Configure

The universal guardrail and the token-route tools need no key. The four paid screening tools use a Caelara API key in `CAELARA_KEY`, which is sent as the `X-Caelara-Key` header.

### Desktop MCP clients

Add this to your desktop assistant's MCP server configuration file (the `mcpServers` section):

```json
{
  "mcpServers": {
    "caelara-shield": {
      "command": "npx",
      "args": ["-y", "@caelaralabs/shield-mcp"],
      "env": { "CAELARA_KEY": "your-key (optional)" }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in your project, or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "caelara-shield": {
      "command": "npx",
      "args": ["-y", "@caelaralabs/shield-mcp"],
      "env": { "CAELARA_KEY": "your-key (optional)" }
    }
  }
}
```

### OpenClaw

Copy `examples/openclaw/` into your skills folder (for example `~/.openclaw/skills/caelara-shield/`). The skill calls the HTTP API with `curl` and needs no MCP setup. To use the MCP server instead, add the same `mcpServers` block to your OpenClaw MCP configuration.

### x402 agents (pay per call in USDC on Base)

Agents with a Base wallet can skip API keys entirely:
1. Call the REST routes directly.
2. A paid route without a key answers `402 Payment Required` with x402 terms (`X-Payment-Required`).
3. Settle in USDC on Base and retry with the `X-PAYMENT` header.

The terms are listed at `https://shield.caelaralabs.com/x402-manifest.json`. The guardrail and token-route routes are free and never ask for payment.

```bash
curl -s https://shield.caelaralabs.com/v1/shield/prompt -H 'Content-Type: application/json' -d '{"text":"..."}' -i | grep -i x-payment-required
```

### Optional environment variables

- `CAELARA_SHIELD_URL`: base URL (default `https://shield.caelaralabs.com`).
- `CAELARA_SHIELD_TIMEOUT_MS`: request timeout in milliseconds (default `3000`).

## Behaviour

- **Stateless:** nothing is written to disk, and request and response bodies are never logged.
- **Requests:** every upstream request has a 3000 ms timeout and sends `User-Agent: CaelaraLabs-Engine/1.0`.
- **Errors:** failures come back as tool results with `isError: true` and a JSON body (`timeout`, `network_error`, `upstream_error`, `invalid_arguments`, `policy_blocked`, `jurisdiction_restricted`). The server never throws to the client.
- **Payment:** a paid tool without a valid key returns `payment_required` with the x402 terms.
- **Keys:** no tool accepts a private key, seed phrase or signer.

## Adapters

Ready-made adapters are in `examples/`:
- Coinbase AgentKit
- elizaOS
- the GOAT SDK
- OpenClaw

## Test

```
node --test test/
```

## License

MIT. Caelara Labs, ops@caelaralabs.com.
