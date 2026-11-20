# Coinbase AgentKit adapter

`shield-route-action-provider.ts` is a custom AgentKit action provider exposing `shield_route_quote` and `shield_safe_swap` against `https://shield.caelaralabs.com/v1/route/*`. Free, no key. It returns unsigned transactions as a JSON string; signing is left to the agent wallet's own provider.

Not run against the framework in CI; check the framework version before use.

Based on: the AgentKit TypeScript custom action provider docs (https://docs.cdp.coinbase.com/agent-kit/core-concepts/agents-actions) and the `@coinbase/agentkit` README, read 2026-11-19. Package version not pinned or checked.

Confirmed from docs: `ActionProvider<WalletProvider>`, `super(id, [])`, `@CreateAction({ name, description, schema })`, actions return `Promise<string>`, `supportsNetwork`, registration via `actionProviders`, and tsconfig `experimentalDecorators` / `emitDecoratorMetadata`.

Not confirmed: the exact `supportsNetwork` declaration style (method or property) in your installed version. The docs page itself returned 404 on direct fetch, so details come from a search summary and the repository README. Adjust to your version.

Requires `zod` and `@coinbase/agentkit`. Heuristic screening; 0.50% fee included in the quote.
