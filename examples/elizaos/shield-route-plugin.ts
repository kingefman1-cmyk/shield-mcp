// Caelara Shield router adapter for elizaOS (TypeScript).
// Based on the elizaOS plugin docs:
//   https://docs.elizaos.ai/plugins/components
//   https://docs.elizaos.ai/plugins/reference
// Calls POST /v1/route/quote and /v1/route/build with plain fetch.
// Returns UNSIGNED transactions in ActionResult.data. No keys, no signing:
// the agent's own wallet plugin signs and submits.
import type { Action, ActionResult, IAgentRuntime, Plugin } from "@elizaos/core";

const BASE_URL = "https://shield.caelaralabs.com";

async function callRoute(path: string, body: unknown): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: "network_error", message: String((e as Error).message) };
  } finally {
    clearTimeout(timer);
  }
}

// Parameters: the docs read did not define a standard way to pass structured arguments to
// an action. This adapter reads options.parameters if present, else a JSON object in the
// message text. Replace with your own extraction step (UNCONFIRMED).
function readParams(message: any, options: any): Record<string, unknown> | null {
  if (options && typeof options.parameters === "object" && options.parameters) return options.parameters;
  const text: string = message?.content?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function make(name: string, path: string, description: string, needTaker: boolean): Action {
  return {
    name,
    similes: needTaker ? ["SAFE_SWAP", "BUILD_SWAP"] : ["ROUTE_QUOTE", "SWAP_QUOTE"],
    description,
    examples: [],
    validate: async (_runtime: IAgentRuntime, message: any) => {
      const p = readParams(message, undefined);
      return !!p && (!needTaker || typeof p.taker === "string");
    },
    handler: async (_runtime, message, _state, options, callback): Promise<ActionResult> => {
      const p = readParams(message, options);
      if (!p) return { success: false, text: "missing route parameters" };
      const r = await callRoute(path, p);
      const text = r.ok
        ? `${name}: ${r.kind} via ${r.provider}, screening verdict ${r.screening?.verdict} (heuristic). 0.50% fee included. Unsigned only.`
        : `${name} failed: ${r.error}: ${r.message}`;
      if (callback) await callback({ text });
      return { success: !!r.ok, text, data: r };
    },
  };
}

export const shieldRouteQuote = make(
  "SHIELD_ROUTE_QUOTE",
  "/v1/route/quote",
  "Get an unsigned swap or bridge quote across solana, ethereum, base, arbitrum, optimism, polygon, bnb. 0.50% fee included. Heuristic token screening.",
  false,
);

export const shieldSafeSwap = make(
  "SHIELD_SAFE_SWAP",
  "/v1/route/build",
  "Screen both tokens (heuristic) and build UNSIGNED swap or bridge transactions. Returns risk.riskLevel and flags; with strictBlock true a high-risk route is refused (policy_blocked). Heuristic screening — will miss attacks. Requires taker. Never signs.",
  true,
);

export const shieldRoutePlugin: Plugin = {
  name: "caelara-shield-route",
  description: "Unsigned, screened swap and bridge routing from Caelara Shield",
  actions: [shieldRouteQuote, shieldSafeSwap],
};
