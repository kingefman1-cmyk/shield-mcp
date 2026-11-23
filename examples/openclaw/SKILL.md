---
name: caelara-shield
description: Pre-execution screening with Caelara Shield by Caelara Labs. Before signing a transaction, paying an address or trusting a token, screen it and show the verdict to the user. Also screens untrusted prompts and model output. Needs a Caelara key (free 50-call trial).
homepage: https://caelaralabs.com/shield/
metadata: { "openclaw": { "requires": { "bins": ["curl"], "env": ["CAELARA_KEY"] } } }
---

# Caelara Shield screening

Use this skill **before** you sign, approve or pay anything from a wallet, and whenever the user asks whether a token, transaction,
address, prompt or model output is safe.

Caelara Shield only screens. It never builds, signs or submits a transaction and never needs a private key. Heuristic screening —
will miss attacks: "no findings" is not proof of safety.

Set `CAELARA_KEY` to a Caelara key (free 50-call trial at https://caelaralabs.com/shield/#trial).

## Screen a token, a transaction or a destination

```bash
curl -s https://shield.caelaralabs.com/v1/shield/tx \
  -H "X-Caelara-Key: $CAELARA_KEY" -H 'Content-Type: application/json' \
  -d '{"token":"<token address or Solana mint>","chain":"base","destination":"<address you will pay>","known_addresses":["<addresses you trust>"]}'
```

At least one of `token`, `hash` (an EVM transaction hash) or `destination` is required. `chain` is one of solana, ethereum, base,
arbitrum, optimism, polygon or bnb (default base). 0.050 USDC per call.

## Screen untrusted text and model output

```bash
curl -s https://shield.caelaralabs.com/v1/shield/prompt -H "X-Caelara-Key: $CAELARA_KEY" -H 'Content-Type: application/json' -d '{"text":"...","redact":true}'
curl -s https://shield.caelaralabs.com/v1/shield/output -H "X-Caelara-Key: $CAELARA_KEY" -H 'Content-Type: application/json' -d '{"output":"..."}'
```

0.015 USDC per call each.

## Rules

1. **Show the verdict before acting.** Show `verdict` (`allow`, `review` or `block`) and every finding to the user before anything is signed.
2. **`block` means stop.** Do not sign or pay unless the user explicitly confirms after seeing the findings.
3. **`review` means ask.** Get explicit confirmation from the user first.
4. **Never paste a private key or seed phrase anywhere.** Shield never asks for one.

## Alternative: MCP server

```json
{ "mcpServers": { "caelara-shield": { "command": "npx", "args": ["-y", "@caelaralabs/shield-mcp"], "env": { "CAELARA_KEY": "your-key" } } } }
```

The tools are `shield_audit_token`, `shield_scan_prompt`, `shield_validate_output` and `shield_proxy_fetch`.

Powered by Caelara Labs · ops@caelaralabs.com
