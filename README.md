# @caelaralabs/shield-mcp

**Caelara Shield by Caelara Labs: pre-execution security screening MCP server.**

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server that lets an agent check what it is about to do before anything is signed or sent. It screens:

- prompts and model outputs,
- outbound fetches,
- tokens, transactions and destination addresses (including address-poisoning lookalikes).

It only screens: it never builds, holds keys for, signs or submits a transaction.

Plain Node ESM, zero runtime dependencies, Node 18 or newer.

```
npx -y @caelaralabs/shield-mcp
```

Heuristic screening — will miss attacks. No findings is not proof of safety.

## Tools

| Tool | What it checks | Route | Price |
|---|---|---|---|
| `shield_preflight` | Optional, once at start-up: your system prompt and tool descriptions (injection, tool poisoning, embedded secrets). Returns a `clearance_id` that later calls carry | `POST /v1/shield/preflight` | 0.005 USDC |
| `shield_scan_prompt` | Untrusted input before it reaches a model: injection, hidden characters, PII, secrets | `POST /v1/shield/prompt` | 0.015 USDC |
| `shield_validate_output` | Model output before it is used: leakage, exfiltration links, active content, shell patterns | `POST /v1/shield/output` | 0.015 USDC |
| `shield_proxy_fetch` | An https fetch through an SSRF-guarded proxy, with the body scanned | `GET /v1/proxy/_?url=...` | 0.025 USDC |
| `shield_audit_token` | A token, a broadcast transaction hash, or a destination address (poisoning lookalikes) | `POST /v1/shield/tx` | 0.050 USDC |

**Retired on 2026-11-22:** `shield_route_quote`, `shield_safe_swap` and `shield_universal_action`. Caelara Shield no longer builds swap routes, orders or unsigned payloads; their REST routes answer `410 Gone`. Version 1.4.1 removes the three tools. To check a token or transaction before signing, use `shield_audit_token`.

## Configure

The screening tools use a Caelara API key, sent as the `X-Caelara-Key` header: `CAELARA_KEY` if set, otherwise the key saved by `init` (see First-Call Fuel below). The `env` block in the examples is optional. A free trial key (50 calls, no card) is at https://caelaralabs.com/shield/#trial, or run the quickstart below.

### Desktop MCP clients

Add this to your desktop assistant's MCP server configuration file (the `mcpServers` section):

```json
{
  "mcpServers": {
    "caelara-shield": {
      "command": "npx",
      "args": ["-y", "@caelaralabs/shield-mcp"],
      "env": { "CAELARA_KEY": "your-key" }
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
      "env": { "CAELARA_KEY": "your-key" }
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

The terms are listed at `https://shield.caelaralabs.com/x402-manifest.json`.

```bash
curl -s https://shield.caelaralabs.com/v1/shield/prompt -H 'Content-Type: application/json' -d '{"text":"..."}' -i | grep -i x-payment-required
```

### Optional environment variables

- `CAELARA_SHIELD_URL`: base URL (default `https://shield.caelaralabs.com`).
- `CAELARA_SHIELD_TIMEOUT_MS`: request timeout in milliseconds (default `3000`).
- `CAELARA_CLEARANCE`: optional `clearance_id` from an earlier preflight, sent as `X-Caelara-Clearance`. Preflight is opt-in: nothing is called or charged at start-up, and once the agent runs `shield_preflight` its clearance is sent with later calls in that session.

## Behaviour

- **Stateless:** nothing is written to disk, and request and response bodies are never logged.
- **Requests:** every upstream request has a 3000 ms timeout and sends `User-Agent: CaelaraLabs-Engine/1.0`.
- **Errors:** failures come back as tool results with `isError: true` and a JSON body (`timeout`, `network_error`, `upstream_error`, `invalid_arguments`, `payment_required`). The server never throws to the client.
- **Payment:** a paid tool without a valid key returns `payment_required` with the x402 terms.
- **Keys:** no tool accepts a private key, seed phrase or signer.

## Adapters

`examples/openclaw/` is an OpenClaw skill that calls the screening routes with `curl`.

## Test

```
node --test test/
```

## License

MIT. Powered by Caelara Labs · ops@caelaralabs.com.

## First-Call Fuel: a free trial with no signup

The first time you run `npx -y @caelaralabs/shield-mcp init`, or the first time the server handles a tool call without a key, it requests a free
trial key for this installation: 50 calls over 7 days, no card.

- **What is sent:** only a SHA-256 hash of `caelara-install-v1|<hostname>|<username>|<home directory>`. The raw hostname, username
  and path never leave your machine. The same installation always gets the same trial back (no duplicates); a different user,
  home directory or CI runner gets its own. The service also applies per-network rate limits.
- **Where it is kept:** `~/.caelaralabs/credentials.json`, readable by you only (mode 0600 on macOS and Linux; on Windows the file
  sits in your user profile, which Windows protects with its own permissions). It is never written into a project folder or into
  your MCP client config, and it is only ever printed masked.
- **Order of precedence:** `CAELARA_KEY` in the environment, then the saved credentials, then a free trial, then no key (each call
  then answers with its x402 pay-per-call terms).
- **Opt out:** set `CAELARA_NO_AUTO_TRIAL=1`. Nothing is requested during the MCP handshake; provisioning happens only before the
  first tool call.
- **When the trial runs out:** upgrade at https://caelaralabs.com/pay/personal (card or PayPal), see plans at
  https://caelaralabs.com/#pricing, or pay per call with x402 USDC on Base.

## Quickstart

```
npx -y @caelaralabs/shield-mcp init
```

Gets a free trial key for this installation (or, with `--email you@company.com`, for that address), saves it to `~/.caelaralabs/credentials.json`, adds the server to `~/.cursor/mcp.json` (existing entries are kept and a `.bak` copy is made), and checks that the Shield host answers. For any other MCP client that reads an `mcpServers` JSON file, pass its path with `--config <path>`. Use `--dry-run` to preview, or set `CAELARA_KEY` to reuse a key you already have.
