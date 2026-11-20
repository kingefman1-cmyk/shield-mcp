# @caelaralabs/shield-mcp

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server for Caelara Shield. It exposes six tools that call `https://shield.caelaralabs.com/v1/...`. Plain Node ESM, no runtime dependencies, Node 18 or newer.

Install line: `npx -y @caelaralabs/shield-mcp`

Shield results are heuristic checks, not guarantees.

## Tools

| Tool | Route | Price per call |
|---|---|---|
| `shield_route_quote` | `POST /v1/route/quote` | free, no key |
| `shield_safe_swap` | `POST /v1/route/build` | free, no key |
| `shield_scan_prompt` | `POST /v1/shield/prompt` | 0.015 USDC |
| `shield_validate_output` | `POST /v1/shield/output` | 0.015 USDC |
| `shield_proxy_fetch` | `GET /v1/proxy/_?url=...` | 0.025 USDC |
| `shield_audit_token` | `POST /v1/shield/tx` | 0.050 USDC |

Input schemas for the four original tools match `https://shield.caelaralabs.com/mcp.json`.

## Safe swap

`shield_route_quote` returns an unsigned swap or bridge quote across solana, ethereum, base, arbitrum, optimism, polygon and bnb. The 0.50% integrator fee is included in the quote. `shield_safe_swap` screens both tokens, refuses high-risk or unscreened tokens unless `overrideRisk` is true, and returns unsigned transactions only. `taker` (the wallet address on `fromChain`) is required for `shield_safe_swap`.

Neither tool accepts a private key, seed or signer, and nothing here signs or holds keys. Your own wallet signs and submits the returned transactions. Both tools work without `CAELARA_KEY`.

Example arguments (Base, 10 USDC to native ETH; `amount` is in the smallest units of `tokenIn`):

```json
{ "fromChain": "base", "tokenIn": "<USDC address>", "tokenOut": "native", "amount": "10000000", "taker": "<your wallet>" }
```

Adapters for Coinbase AgentKit, elizaOS and the GOAT SDK are in `examples/`.

### Caveats

- Token screening is heuristic. No findings is not proof of safety.
- Quotes can change and expire (see `expiresInSeconds`).
- Execution is by your own wallet. Caelara never holds keys or funds.
- Partner revenue sharing is not offered; requests with `partnerWallet` or `partnerBps` are rejected.
- Solana-to-EVM bridging is not supported.
- Polygon and BNB tokens are not screened, so builds on those chains need `overrideRisk: true`.

## Configure

The four original tools need a Caelara API key: set `CAELARA_KEY`. It is sent as the `X-Caelara-Key` header. The key is read from the environment only. The two route tools do not require it.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "shield": {
      "command": "npx",
      "args": ["-y", "@caelaralabs/shield-mcp"],
      "env": { "CAELARA_KEY": "your-key" }
    }
  }
}
```

Optional environment variables:

- `CAELARA_SHIELD_URL`: override the base URL (default `https://shield.caelaralabs.com`).
- `CAELARA_SHIELD_TIMEOUT_MS`: request timeout in milliseconds (default `3000`).

## Behaviour

- Stateless. Nothing is written to disk and request or response bodies are never logged.
- Every upstream request has a 3000 ms timeout and sends `User-Agent: CaelaraLabs-Engine/1.0`.
- Failures are returned as tool results with `isError: true` and a JSON body (`timeout`, `network_error`, `upstream_error`, `invalid_arguments`). The server does not throw to the client.
- Without a valid key, a `402` response is returned as `payment_required`, including the `X-Payment-Required` header value and the response body so you can see the x402 terms. Paying via x402 happens on the REST routes (see `https://shield.caelaralabs.com/x402-manifest.json`), not through this server.

## Test

```
node --test test/
```

The tests start a local fake HTTP server and exercise initialize, tools/list and tools/call (success, 402, timeout).

## License

MIT. Caelara Labs, ops@caelaralabs.com.
