// Caelara Shield router adapter for the GOAT SDK (TypeScript).
// Based on the GOAT SDK source and its published plugins (PluginBase, @Tool, createToolParameters):
//   https://github.com/goat-sdk/goat/blob/main/typescript/packages/core/src/classes/PluginBase.ts
//   https://github.com/goat-sdk/goat/tree/main/typescript/packages/plugins/rugcheck
// Calls POST /v1/route/quote and /v1/route/build with plain fetch.
// Returns UNSIGNED transactions. No keys, no signing: the GOAT wallet client signs and sends.
import { Chain, PluginBase, Tool, createToolParameters } from "@goat-sdk/core";
import { z } from "zod";

const BASE_URL = "https://shield.caelaralabs.com";
const CHAINS = ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bnb"] as const;

const routeShape = {
  fromChain: z.enum(CHAINS),
  toChain: z.enum(CHAINS).optional().describe("Different from fromChain means a bridge"),
  tokenIn: z.string().describe('"native", a token address or a Solana mint'),
  tokenOut: z.string().describe('"native", a token address or a Solana mint'),
  amount: z.string().regex(/^[0-9]+$/).describe("Integer string, smallest units of tokenIn"),
  slippageBps: z.number().int().min(1).max(500).optional(),
  strictBlock: z.boolean().optional().describe("Refuse high-risk routes with policy_blocked (default false: risk-labelled and still built)"),
};

class QuoteParameters extends createToolParameters(
  z.object({ ...routeShape, taker: z.string().optional() }),
) {}

class SafeSwapParameters extends createToolParameters(
  z.object({ ...routeShape, taker: z.string().describe("Wallet address on fromChain that will sign") }),
) {}

async function callRoute(path: string, body: unknown): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    return await res.json(); // contract response or { ok: false, error, message }
  } catch (e) {
    return { ok: false, error: "network_error", message: String((e as Error).message) };
  } finally {
    clearTimeout(timer);
  }
}

export class ShieldRouteService {
  @Tool({
    name: "shield_route_quote",
    description:
      "Get an unsigned swap or bridge quote. 0.50% fee included in the quote. Token screening is heuristic. Nothing is signed.",
  })
  async quote(parameters: QuoteParameters) {
    return callRoute("/v1/route/quote", parameters);
  }

  @Tool({
    name: "shield_safe_swap",
    description:
      "Screen both tokens (heuristic) and build UNSIGNED swap or bridge transactions. Returns risk.riskLevel and flags; with strictBlock true a high-risk route is refused (policy_blocked). Heuristic screening — will miss attacks. Never signs.",
  })
  async safeSwap(parameters: SafeSwapParameters) {
    return callRoute("/v1/route/build", parameters);
  }
}

export class ShieldRoutePlugin extends PluginBase {
  constructor() {
    super("caelara-shield-route", [new ShieldRouteService()]);
  }

  supportsChain = (_chain: Chain) => true;
}

export const shieldRoute = () => new ShieldRoutePlugin();

// Usage: pass shieldRoute() in the plugins list of your GOAT adapter (see the GOAT SDK docs for
// the adapter you use). Signing stays with the GOAT wallet client.
