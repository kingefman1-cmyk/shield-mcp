# Caelara Shield Snap

`@caelaralabs/shield-snap` is a MetaMask Snap that adds a **Caelara Shield** panel to the MetaMask confirmation
screen. It decodes the transaction you are about to sign, flags risky patterns such as unlimited approvals, and shows a
LOW RISK, MEDIUM RISK or HIGH RISK banner.

**Heuristic screening — will miss attacks.** A LOW RISK banner does not prove a transaction is safe. It only means
these checks found nothing. Always check who you are approving and what you are sending.

The snap never signs, sends or changes a transaction. It never asks for your secret recovery phrase or any key
material.

## What it checks

### Local checks (always on, no network)

These run inside the snap on chains 1 (Ethereum), 8453 (Base), 42161 (Arbitrum One), 10 (Optimism), 137 (Polygon)
and 56 (BNB Smart Chain):

| Call | Selector | Result |
| --- | --- | --- |
| `approve(address,uint256)` | `0x095ea7b3` | Unlimited (at least 2^255, or max uint256): **HIGH**. Spender not a known router: at least **MEDIUM**. Exact amount to a known router: **LOW**. `approve(x, 0)` is shown as a revocation. |
| `increaseAllowance(address,uint256)` | `0x39509351` | Same rules as `approve`. |
| `setApprovalForAll(address,bool)` | `0xa22cb465` | `true`: **HIGH**. `false`: revocation. |
| `transfer(address,uint256)` | `0xa9059cbb` | Shows the recipient and amount. To the zero address or the token contract itself: **HIGH**. To a router contract: **MEDIUM**. |
| `transferFrom(address,address,uint256)` | `0x23b872dd` | Shows source, recipient and amount. Source differs from the signer: **MEDIUM**. |
| Permit2 `approve(address,address,uint160,uint48)` | `0x87517c45` | Unlimited: **HIGH**. Unknown spender: **MEDIUM**. Not the canonical Permit2 contract: **MEDIUM**. |
| Native transfer (empty calldata) | — | Shows the recipient and the value in wei. To the zero address: **HIGH**. |
| Call to a known router | any | **LOW**, labelled with the router name. |
| Any other contract call or contract deployment | — | **MEDIUM**: the calldata was not recognised. |

Known routers and spenders: Velora Augustus v6, KyberSwap meta aggregation router, 0x AllowanceHolder, Relay
depository, deBridge DlnSource, Uniswap Permit2, and the Uniswap Universal Router addresses for each chain (current,
2.1.1 and 2.1.2) from the Uniswap v4 deployments page. The list is in `src/constants.ts`.

The snap does not read chain state. It has no Ethereum provider permission, so it cannot check whether an address is a
contract, look up balances, or simulate the transaction.

### Remote checks (optional, needs your own key)

If you store a Caelara API key, the snap also sends the token contract and the destination (recipient or spender) of
the transaction to `POST https://shield.caelaralabs.com/v1/shield/tx` (Ethereum, Base, Arbitrum and Optimism). The
API returns a token safety screen and destination checks. Its verdict maps to the banner (`allow` to LOW, `review` to
MEDIUM, `block` to HIGH) and its findings are listed as flags. The worse of the local and remote results is shown.

Only these fields are sent: `chain`, `token` and `destination`. Your own address, the calldata and the value are not
sent.

If no key is stored, or the key is not accepted (401, 402 or 403), the panel says
"Remote screening unavailable: add a free trial key at https://caelaralabs.com/shield/". On a network failure or
timeout it says "Shield API unreachable". In both cases the local result is still shown. The snap never blocks a
transaction and never shows an error instead of the panel.

## Permissions

| Permission | Why |
| --- | --- |
| `endowment:transaction-insight` (`allowTransactionOrigin: true`) | Shows the panel on the confirmation screen. The origin flag lets the snap see which site asked for the transaction. |
| `endowment:network-access` | Calls the Caelara Shield API for the optional remote check and the route methods. |
| `endowment:rpc` (`dapps: true`, `snaps: false`) | Lets websites call the `caelara_*` methods below. Other snaps cannot call it. |
| `snap_manageState` | Stores your optional Caelara API key in MetaMask's encrypted snap storage. Nothing else is stored. |

No other permissions are requested. In particular the snap does not request `snap_getBip32Entropy`,
`snap_getBip44Entropy`, `snap_getBip32PublicKey`, `snap_getEntropy`, any keyring permission or
`endowment:ethereum-provider`.

### Why network access is limited in code

A snap's manifest cannot restrict network access to particular domains. Every request in this snap goes through one
function, `safeFetch` in `src/net.ts`. It refuses any URL that is not `https://shield.caelaralabs.com` or
`https://caelaralabs.com` (no other host, port, scheme or embedded credentials), refuses redirects, cancels a request
that runs past its time limit, and returns failures as values instead of throwing.

## Adding a key

Keys look like `ck_trial_...` or `ck_live_...` (lower-case letters and digits). You can get a free trial key at
https://caelaralabs.com/shield/.

For your safety, the key can only be set or cleared from `https://caelaralabs.com`. Calls from any other site are
rejected. The key is never returned by any method.

## RPC methods

Call these with `wallet_invokeSnap` and the snap ID `npm:@caelaralabs/shield-snap`.

| Method | Params | Result |
| --- | --- | --- |
| `caelara_screenTransaction` | `{ chainId, to, data?, value?, from? }`. `chainId` is CAIP-2 (`eip155:1`) or hex (`0x1`). | `{ chainId, supportedChain, riskLevel, flags, decoded, remote, disclosure }`. Local checks only: the remote check (which uses your key) runs only in the MetaMask confirmation panel, never on a website's request. |
| `caelara_quoteScreenedRoute` | Route body: `{ fromChain, toChain?, tokenIn, tokenOut, amount, slippageBps?, taker?, recipient?, strictBlock? }` | The `POST /v1/route/quote` response. A `422 policy_blocked` (when `strictBlock` is `true` and the route risk is high) comes back as a result: `{ ok: false, httpStatus: 422, error: 'policy_blocked', policy, message, risk }`. |
| `caelara_buildScreenedRoute` | Same body; `taker` is required, and `recipient` is required for EVM to Solana routes. | The `POST /v1/route/build` response, with unsigned transactions. The snap never signs them; your wallet does, after you review them. |
| `caelara_setApiKey` | `{ key }` | `{ keyConfigured: true }`. Only from `https://caelaralabs.com`. |
| `caelara_clearApiKey` | none | `{ keyConfigured: false }`. Only from `https://caelaralabs.com`. |
| `caelara_getStatus` | none | `{ keyConfigured }`. |

Chains for the route methods: `solana`, `ethereum`, `base`, `arbitrum`, `optimism`, `polygon`, `bnb`. `amount` is an
integer string in the smallest unit of `tokenIn`. `slippageBps` is 1 to 500. Unknown fields are rejected. The route
endpoints are free and need no key. **Route quotes include a 0.50% (50 bps) protocol fee.** The API reports it in `fee`, and every route result from the
snap carries it in `feeDisclosure`.

Example:

```js
const result = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@caelaralabs/shield-snap',
    request: {
      method: 'caelara_quoteScreenedRoute',
      params: { fromChain: 'base', tokenIn: 'native', tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amount: '1000000000000000', strictBlock: true },
    },
  },
});
```

The transaction insight panel itself shows no route quotes; route quotes are returned only by the two route methods.

## Install for testing (MetaMask Flask)

1. Install [MetaMask Flask](https://metamask.io/flask/), the developer build of MetaMask.
2. From a page, request the snap:

   ```js
   await window.ethereum.request({
     method: 'wallet_requestSnaps',
     params: { 'npm:@caelaralabs/shield-snap': {} },
   });
   ```

3. Start any transaction on a supported chain. The Caelara Shield panel appears on the confirmation screen.

Production MetaMask only installs snaps that are allowlisted in the MetaMask Snaps Directory. Until this snap is
allowlisted, use MetaMask Flask.

## Development

```sh
npm install
npm run build        # mm-snap build
npm run manifest     # mm-snap manifest
npm run eval         # mm-snap eval (SES check)
npm test             # @metamask/snaps-jest and unit tests (build first)
```

The snaps-jest tests replace the network inside the snap's test worker with fixtures from
`test/support/mock-fetch.js`. No test contacts a real server.

## License

MIT. Caelara Labs, ops@caelaralabs.com.

Heuristic screening — will miss attacks.
