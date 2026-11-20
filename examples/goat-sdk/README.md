# GOAT SDK adapter

`shield-route-plugin.ts` is a GOAT SDK plugin exposing `shield_route_quote` and `shield_safe_swap` against `https://shield.caelaralabs.com/v1/route/*`. Free, no key. It returns unsigned transactions; signing is left to the GOAT wallet client.

Not run against the framework in CI; check the framework version before use.

Based on: the `goat-sdk/goat` repository on GitHub, `PluginBase` in `typescript/packages/core` and the `rugcheck` plugin under `typescript/packages/plugins`, read 2026-11-19 (`main` branch, no release tag checked). No GOAT plugin-authoring page could be fetched, so this follows the source, via summaries.

Confirmed from source: `PluginBase(name, toolProviders[])` with an abstract `supportsChain(chain)`, `@Tool({ name, description })` on provider methods taking a parameters class, `createToolParameters` from `@goat-sdk/core`, and the `rugcheck()` factory pattern.

Not confirmed: whether your version passes a wallet client as an extra `@Tool` method argument, the `Chain` import path, and how to register the plugin in your chosen adapter (not verified here).

Heuristic screening; 0.50% fee included in the quote.
