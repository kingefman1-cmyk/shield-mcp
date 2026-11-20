# @caelaralabs/shield-mcp

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server for Caelara Shield. It exposes four tools that call `https://shield.caelaralabs.com/v1/...`. Plain Node ESM, no runtime dependencies, Node 18 or newer.

Shield results are heuristic checks, not guarantees.

## Tools

| Tool | Route | Price per call |
|---|---|---|
| `shield_scan_prompt` | `POST /v1/shield/prompt` | 0.015 USDC |
| `shield_validate_output` | `POST /v1/shield/output` | 0.015 USDC |
| `shield_proxy_fetch` | `GET /v1/proxy/_?url=...` | 0.025 USDC |
| `shield_audit_token` | `POST /v1/shield/tx` | 0.050 USDC |

Input schemas match `https://shield.caelaralabs.com/mcp.json`.

## Configure

Set `CAELARA_KEY` to your Caelara API key. It is sent as the `X-Caelara-Key` header. The key is read from the environment only.

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
