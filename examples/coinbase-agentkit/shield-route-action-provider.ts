// Caelara Shield router adapter for Coinbase AgentKit (TypeScript).
// Based on the AgentKit custom action provider docs:
//   https://docs.cdp.coinbase.com/agent-kit/core-concepts/agents-actions
//   https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/README.md
// Calls POST /v1/route/quote and /v1/route/build with plain fetch.
// Returns UNSIGNED transactions as a JSON string. No keys, no signing here:
// the agent's own wallet provider signs and submits.
import { ActionProvider, CreateAction, Network, WalletProvider } from "@coinbase/agentkit";
import { z } from "zod";

const BASE_URL = "https://shield.caelaralabs.com";
const CHAINS = ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bnb"] as const;

const RouteSchema = z.object({
  fromChain: z.enum(CHAINS).describe("Source chain"),
  toChain: z.enum(CHAINS).optional().describe("Destination chain; a different value means a bridge"),
  tokenIn: z.string().describe('"native", a token address or a Solana mint'),
  tokenOut: z.string().describe('"native", a token address or a Solana mint'),
  amount: z.string().regex(/^[0-9]+$/).describe("Integer string, smallest units of tokenIn"),
  slippageBps: z.number().int().min(1).max(500).optional(),
  taker: z.string().optional().describe("Wallet address on fromChain (required for builds)"),
  overrideRisk: z.boolean().optional().describe("Let a high-risk or unscreened token through (default false)"),
});

const SafeSwapSchema = RouteSchema.extend({
  taker: z.string().describe("Wallet address on fromChain that will sign"),
});

async function callRoute(path: "/v1/route/quote" | "/v1/route/build", body: unknown): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    return await res.text(); // JSON: the contract response, or { ok: false, error, message }
  } catch (e) {
    return JSON.stringify({ ok: false, error: "network_error", message: String((e as Error).message) });
  } finally {
    clearTimeout(timer);
  }
}

export class ShieldRouteActionProvider extends ActionProvider<WalletProvider> {
  constructor() {
    super("caelara-shield-route", []);
  }

  @CreateAction({
    name: "shield_route_quote",
    description:
      "Get an unsigned swap or bridge quote. 0.50% fee included in the quote. Token screening is heuristic. Nothing is signed.",
    schema: RouteSchema,
  })
  async quote(_wallet: WalletProvider, args: z.infer<typeof RouteSchema>): Promise<string> {
    return callRoute("/v1/route/quote", args);
  }

  @CreateAction({
    name: "shield_safe_swap",
    description:
      "Screen both tokens (heuristic) and build UNSIGNED swap or bridge transactions. Refuses high-risk or unscreened tokens unless overrideRisk is true. The caller signs with its own wallet.",
    schema: SafeSwapSchema,
  })
  async safeSwap(_wallet: WalletProvider, args: z.infer<typeof SafeSwapSchema>): Promise<string> {
    return callRoute("/v1/route/build", args);
  }

  supportsNetwork = (_network: Network): boolean => true;
}

export const shieldRouteActionProvider = () => new ShieldRouteActionProvider();

// Usage (docs pattern):
//   const agentKit = await AgentKit.from({ walletProvider, actionProviders: [shieldRouteActionProvider()] });
// The agent then signs the returned transactions with its wallet provider's own methods.
