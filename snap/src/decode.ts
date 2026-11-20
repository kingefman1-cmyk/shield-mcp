// Minimal, dependency-free calldata decoding for the handful of calls the snap screens.

export const SELECTORS = {
  approve: '0x095ea7b3',
  increaseAllowance: '0x39509351',
  setApprovalForAll: '0xa22cb465',
  transfer: '0xa9059cbb',
  transferFrom: '0x23b872dd',
  permit2Approve: '0x87517c45',
} as const;

export const MAX_UINT256 = (1n << 256n) - 1n;
export const UNLIMITED_THRESHOLD = 1n << 255n;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const PERMIT2_UNLIMITED_THRESHOLD = 1n << 159n;

const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/u;
const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/u;
const DEC_QUANTITY = /^[0-9]{1,78}$/u;
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type Decoded =
  | { kind: 'native_transfer'; to: string; value: bigint }
  | { kind: 'approve'; token: string; spender: string; amount: bigint; method: 'approve' | 'increaseAllowance' }
  | { kind: 'set_approval_for_all'; token: string; operator: string; approved: boolean }
  | { kind: 'transfer'; token: string; recipient: string; amount: bigint }
  | { kind: 'transfer_from'; token: string; from: string; recipient: string; amount: bigint }
  | { kind: 'permit2_approve'; permit2: string; token: string; spender: string; amount: bigint; expiration: bigint }
  | { kind: 'contract_call'; to: string; selector: string; value: bigint }
  | { kind: 'contract_creation'; value: bigint }
  | { kind: 'malformed'; to: string | null; reason: string };

/**
 * Parse a transaction value given as a hex quantity, a decimal string, or nothing.
 * @param value - The raw value.
 * @returns The value in the smallest unit, or null when it cannot be parsed.
 */
export function parseQuantity(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '' || value === '0x') {
    return 0n;
  }
  if (typeof value !== 'string') {
    return null;
  }
  if (HEX_QUANTITY.test(value)) {
    return BigInt(value);
  }
  if (DEC_QUANTITY.test(value)) {
    return BigInt(value);
  }
  return null;
}

/**
 * Normalise calldata to lower-case hex with a 0x prefix.
 * @param data - The raw calldata.
 * @returns The normalised calldata, or null when it is not valid hex bytes.
 */
export function normaliseData(data: unknown): string | null {
  if (data === undefined || data === null || data === '') {
    return '0x';
  }
  if (typeof data !== 'string' || !HEX_DATA.test(data)) {
    return null;
  }
  return data.toLowerCase();
}

const word = (args: string, index: number): string | null => {
  const w = args.slice(index * 64, index * 64 + 64);
  return w.length === 64 ? w : null;
};

const asAddress = (w: string): string | null => (/^0{24}/u.test(w) ? `0x${w.slice(24)}` : null);
const asUint = (w: string): bigint => BigInt(`0x${w}`);
const asBool = (w: string): boolean | null => {
  const v = asUint(w);
  return v === 0n ? false : v === 1n ? true : null;
};

/**
 * Decode a transaction into one of the recognised shapes.
 * @param tx - The transaction fields.
 * @param tx.to - Destination address, or null/undefined for a contract creation.
 * @param tx.data - Calldata as hex.
 * @param tx.value - Value as a hex quantity or decimal string.
 * @returns The decoded transaction.
 */
export function decodeTransaction(tx: { to?: string | null; data?: unknown; value?: unknown }): Decoded {
  const to = typeof tx.to === 'string' && EVM_ADDRESS.test(tx.to) ? tx.to.toLowerCase() : null;
  if (tx.to !== undefined && tx.to !== null && tx.to !== '' && to === null) {
    return { kind: 'malformed', to: null, reason: 'Destination is not a valid EVM address' };
  }
  const value = parseQuantity(tx.value);
  if (value === null) {
    return { kind: 'malformed', to, reason: 'Transaction value could not be parsed' };
  }
  const data = normaliseData(tx.data);
  if (data === null) {
    return { kind: 'malformed', to, reason: 'Calldata is not valid hex' };
  }
  if (to === null) {
    return { kind: 'contract_creation', value };
  }
  if (data === '0x') {
    return { kind: 'native_transfer', to, value };
  }
  if (data.length < 10) {
    return { kind: 'malformed', to, reason: 'Calldata is shorter than a function selector' };
  }

  const selector = data.slice(0, 10);
  const args = data.slice(10);
  const bad = (name: string): Decoded => ({ kind: 'malformed', to, reason: `Calldata for ${name} does not match the expected ABI layout` });

  switch (selector) {
    case SELECTORS.approve:
    case SELECTORS.increaseAllowance: {
      const method = selector === SELECTORS.approve ? 'approve' : 'increaseAllowance';
      const w0 = word(args, 0);
      const w1 = word(args, 1);
      const spender = w0 && asAddress(w0);
      if (!spender || !w1 || args.length !== 128) {
        return bad(method);
      }
      return { kind: 'approve', token: to, spender, amount: asUint(w1), method };
    }
    case SELECTORS.setApprovalForAll: {
      const w0 = word(args, 0);
      const w1 = word(args, 1);
      const operator = w0 && asAddress(w0);
      const approved = w1 ? asBool(w1) : null;
      if (!operator || approved === null || args.length !== 128) {
        return bad('setApprovalForAll');
      }
      return { kind: 'set_approval_for_all', token: to, operator, approved };
    }
    case SELECTORS.transfer: {
      const w0 = word(args, 0);
      const w1 = word(args, 1);
      const recipient = w0 && asAddress(w0);
      if (!recipient || !w1 || args.length !== 128) {
        return bad('transfer');
      }
      return { kind: 'transfer', token: to, recipient, amount: asUint(w1) };
    }
    case SELECTORS.transferFrom: {
      const w0 = word(args, 0);
      const w1 = word(args, 1);
      const w2 = word(args, 2);
      const from = w0 && asAddress(w0);
      const recipient = w1 && asAddress(w1);
      // ERC-721 transferFrom has the same selector; the third word is then a token ID rather than an amount.
      if (!from || !recipient || !w2 || args.length !== 192) {
        return bad('transferFrom');
      }
      return { kind: 'transfer_from', token: to, from, recipient, amount: asUint(w2) };
    }
    case SELECTORS.permit2Approve: {
      // approve(address token, address spender, uint160 amount, uint48 expiration)
      const w0 = word(args, 0);
      const w1 = word(args, 1);
      const w2 = word(args, 2);
      const w3 = word(args, 3);
      const token = w0 && asAddress(w0);
      const spender = w1 && asAddress(w1);
      if (!token || !spender || !w2 || !w3 || args.length !== 256) {
        return { kind: 'contract_call', to, selector, value };
      }
      const amount = asUint(w2);
      const expiration = asUint(w3);
      if (amount > MAX_UINT160 || expiration >= 1n << 48n) {
        return { kind: 'contract_call', to, selector, value };
      }
      return { kind: 'permit2_approve', permit2: to, token, spender, amount, expiration };
    }
    default:
      return { kind: 'contract_call', to, selector, value };
  }
}
