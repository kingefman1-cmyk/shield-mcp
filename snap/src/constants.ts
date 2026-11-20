export const DISCLOSURE = 'Heuristic screening — will miss attacks';
export const FEE_DISCLOSURE = 'Route quotes include a 0.50% (50 bps) protocol fee';
export const SHIELD_PAGE = 'https://caelaralabs.com/shield/';
export const API_BASE = 'https://shield.caelaralabs.com';
export const KEY_ADMIN_ORIGIN = 'https://caelaralabs.com';

// The only origins the snap will ever contact. Snaps cannot scope network access in the manifest, so this list is
// enforced in code by src/net.ts.
export const ALLOWED_ORIGINS: readonly string[] = [
  'https://shield.caelaralabs.com',
  'https://caelaralabs.com',
];

export const NOTE_ADD_KEY = `Remote screening unavailable: add a free trial key at ${SHIELD_PAGE}`;
export const NOTE_UNREACHABLE = 'Shield API unreachable: showing local checks only.';

export const API_KEY_PATTERN = /^ck_(live|trial)_[a-z0-9]{16,64}$/u;

export type ChainInfo = {
  id: number;
  name: string;
  native: string;
  // Chain name accepted by POST /v1/shield/tx, or null when the remote check does not cover the chain.
  shieldChain: string | null;
};

export const CHAINS: Record<number, ChainInfo> = {
  1: { id: 1, name: 'Ethereum', native: 'ETH', shieldChain: 'ethereum' },
  8453: { id: 8453, name: 'Base', native: 'ETH', shieldChain: 'base' },
  42161: { id: 42161, name: 'Arbitrum One', native: 'ETH', shieldChain: 'arbitrum' },
  10: { id: 10, name: 'Optimism', native: 'ETH', shieldChain: 'optimism' },
  137: { id: 137, name: 'Polygon', native: 'POL', shieldChain: null },
  56: { id: 56, name: 'BNB Smart Chain', native: 'BNB', shieldChain: null },
};

export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';

// Router contracts deployed at the same address on every supported chain.
const SHARED_ROUTERS: Record<string, string> = {
  '0x6a000f20005980200259b80c5102003040001068': 'Velora Augustus v6',
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5': 'KyberSwap meta aggregation router',
  '0x0000000000001ff3684f28c67538d4d072c22734': '0x AllowanceHolder',
  '0x4cd00e387622c35bddb9b4c962c136462338bc31': 'Relay depository',
  '0xef4fb24ad0916217251f553c0596f8edc630eb66': 'deBridge DlnSource',
  [PERMIT2]: 'Uniswap Permit2',
};

// Uniswap Universal Router addresses differ per chain (Uniswap v4 deployments page: current, 2.1.1 and 2.1.2).
const UNIVERSAL_ROUTERS: Record<number, string[]> = {
  1: [
    '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca',
    '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85',
  ],
  10: [
    '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
    '0x8b844f885672f333bc0042cb669255f93a4c1e6b',
    '0xc09255d86db563cbc11c2fcf4a0c512e160111b4',
  ],
  8453: [
    '0x6ff5693b99212da76ad316178a184ab56d299b43',
    '0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7',
    '0xd6145b2d3f379919e8cdeda7b97e37c4b2ca9c40',
  ],
  42161: [
    '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
    '0x8b844f885672f333bc0042cb669255f93a4c1e6b',
    '0x2d01411773c8c24805306e89a41f7855c3c4fe65',
  ],
  137: [
    '0x1095692a6237d83c6a72f3f5efedb9a670c49223',
    '0x8b844f885672f333bc0042cb669255f93a4c1e6b',
    '0xdc264714f68d84cf29bc605589405e78bdbe7c9f',
  ],
  56: [
    '0x1906c1d672b88cd1b9ac7593301ca990f94eae07',
    '0x8b844f885672f333bc0042cb669255f93a4c1e6b',
    '0xdc264714f68d84cf29bc605589405e78bdbe7c9f',
  ],
};

/**
 * Look up a known router or spender contract on a chain.
 * @param chainId - Numeric EVM chain ID.
 * @param address - Contract address (any case).
 * @returns The router name, or null when the address is not on the list.
 */
export function knownRouter(chainId: number, address: string): string | null {
  const a = address.toLowerCase();
  if (UNIVERSAL_ROUTERS[chainId]?.includes(a)) {
    return 'Uniswap Universal Router';
  }
  if (CHAINS[chainId] && SHARED_ROUTERS[a]) {
    return SHARED_ROUTERS[a] ?? null;
  }
  return null;
}
