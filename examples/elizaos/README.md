# elizaOS adapter

`shield-route-plugin.ts` is an elizaOS plugin with two actions, `SHIELD_ROUTE_QUOTE` and `SHIELD_SAFE_SWAP`, calling `https://shield.caelaralabs.com/v1/route/*`. Free, no key. Results (unsigned transactions) are returned in `ActionResult.data`; signing is left to the agent's own wallet plugin.

Not run in CI. Checked 2026-11-20 against the published `@elizaos/core` 2.0.5: the file type-checks with `tsc --strict`, and calling each action's `validate` and `handler` directly with `options.parameters` returned a live quote from shield.caelaralabs.com. Not tested: loading the plugin into a running `AgentRuntime`, or how your character's model passes structured parameters to the action (see the note in the file). This was not run in CI.

Based on: elizaOS docs "Plugin components" and "Core interfaces" (https://docs.elizaos.ai/plugins/components, https://docs.elizaos.ai/plugins/reference), read 2026-11-19. `@elizaos/core` version not pinned or checked.

Confirmed from docs: `Action` (`name`, `similes`, `description`, `examples`, `validate`, `handler`), handler signature `(runtime, message, state, options, callback)`, `ActionResult` with required `success` and optional `text`, `data`, `error`, `HandlerCallback(content)`, and `Plugin` with `name`, `description`, `actions`.

Not confirmed: how structured parameters reach an action. The adapter reads `options.parameters` or a JSON object in the message text; swap in your own extraction. The docs fetch summarised the code examples rather than quoting them.

Heuristic screening; 0.50% fee included in the quote.
