# Coinbase AgentKit adapter

`shield-route-action-provider.ts` is a custom AgentKit action provider exposing `shield_route_quote` and `shield_safe_swap` against `https://shield.caelaralabs.com/v1/route/*`. Free, no key. It returns unsigned transactions as a JSON string; signing is left to the agent wallet's own provider.

Not run in CI. Checked 2026-11-20 against the published `@coinbase/agentkit` 0.10.4 (and `zod` 3, which that version requires): the file type-checks with `tsc --strict`, registers two actions (`ShieldRouteActionProvider_shield_route_quote` and `..._shield_safe_swap`) through `getActions`, and a quote call through the framework's own `invoke` returned a live route from shield.caelaralabs.com. Requirements found while testing: your `tsconfig.json` must set `experimentalDecorators` and `emitDecoratorMetadata` (AgentKit reads the parameter types from decorator metadata; a transpile-only runner such as esbuild or tsx fails with "Failed to get parameters for action method"), and the wallet provider you pass must implement `getName`, `getAddress` and `getNetwork` because the decorator reads them. Still not tested: a real agent loop with a funded wallet. This was not run in CI.

Based on: the AgentKit TypeScript custom action provider docs (https://docs.cdp.coinbase.com/agent-kit/core-concepts/agents-actions) and the `@coinbase/agentkit` README, read 2026-11-19. Package version not pinned or checked.

Confirmed from docs: `ActionProvider<WalletProvider>`, `super(id, [])`, `@CreateAction({ name, description, schema })`, actions return `Promise<string>`, `supportsNetwork`, registration via `actionProviders`, and tsconfig `experimentalDecorators` / `emitDecoratorMetadata`.

Not confirmed: the exact `supportsNetwork` declaration style (method or property) in your installed version. The docs page itself returned 404 on direct fetch, so details come from a search summary and the repository README. Adjust to your version.

Requires `zod` and `@coinbase/agentkit`. Heuristic screening; 0.50% fee included in the quote.
