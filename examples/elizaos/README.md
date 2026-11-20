# elizaOS adapter

`shield-route-plugin.ts` is an elizaOS plugin with two actions, `SHIELD_ROUTE_QUOTE` and `SHIELD_SAFE_SWAP`, calling `https://shield.caelaralabs.com/v1/route/*`. Free, no key. Results (unsigned transactions) are returned in `ActionResult.data`; signing is left to the agent's own wallet plugin.

Not run against the framework in CI; check the framework version before use.

Based on: elizaOS docs "Plugin components" and "Core interfaces" (https://docs.elizaos.ai/plugins/components, https://docs.elizaos.ai/plugins/reference), read 2026-11-19. `@elizaos/core` version not pinned or checked.

Confirmed from docs: `Action` (`name`, `similes`, `description`, `examples`, `validate`, `handler`), handler signature `(runtime, message, state, options, callback)`, `ActionResult` with required `success` and optional `text`, `data`, `error`, `HandlerCallback(content)`, and `Plugin` with `name`, `description`, `actions`.

Not confirmed: how structured parameters reach an action. The adapter reads `options.parameters` or a JSON object in the message text; swap in your own extraction. The docs fetch summarised the code examples rather than quoting them.

Heuristic screening; 0.50% fee included in the quote.
