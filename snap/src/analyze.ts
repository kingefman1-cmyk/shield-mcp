import { CHAINS, DISCLOSURE, PERMIT2, knownRouter } from './constants';
import {
  MAX_UINT256,
  PERMIT2_UNLIMITED_THRESHOLD,
  UNLIMITED_THRESHOLD,
  ZERO_ADDRESS,
  decodeTransaction,
  type Decoded,
} from './decode';

export type RiskLevel = 'low' | 'medium' | 'high';
export type FlagSeverity = 'info' | RiskLevel;
export type Flag = { id: string; severity: FlagSeverity; message: string };

export type DecodedJson = {
  kind: Decoded['kind'];
  action: string;
  contract: string | null;
  token: string | null;
  spender: string | null;
  recipient: string | null;
  from: string | null;
  amount: string | null;
  unlimited: boolean;
  value: string | null;
  selector: string | null;
  knownRouter: string | null;
  expiration: string | null;
};

export type Analysis = {
  chainId: string;
  chainName: string | null;
  supportedChain: boolean;
  riskLevel: RiskLevel;
  flags: Flag[];
  decoded: DecodedJson;
  disclosure: string;
};

const RANK: Record<FlagSeverity, number> = { info: 0, low: 1, medium: 2, high: 3 };

/**
 * Return the more severe of two risk levels.
 * @param a - First level.
 * @param b - Second level.
 * @returns The worse level.
 */
export function worst(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RANK[b] > RANK[a] ? b : a;
}

/**
 * Parse a chain ID given as CAIP-2 (eip155:N), a hex quantity or a decimal string.
 * @param chainId - The raw chain ID.
 * @returns The numeric chain ID, or null when it is not an EVM chain ID.
 */
export function parseChainId(chainId: unknown): number | null {
  if (typeof chainId !== 'string') {
    return null;
  }
  const caip = /^eip155:([1-9][0-9]{0,15})$/u.exec(chainId);
  if (caip?.[1]) {
    return Number(caip[1]);
  }
  if (/^0x[0-9a-fA-F]{1,13}$/u.test(chainId)) {
    const n = Number.parseInt(chainId.slice(2), 16);
    return n > 0 ? n : null;
  }
  return null;
}

const isUnlimited = (amount: bigint): boolean => amount >= UNLIMITED_THRESHOLD || amount === MAX_UINT256;

const emptyDecoded = (kind: Decoded['kind'], action: string): DecodedJson => ({
  kind,
  action,
  contract: null,
  token: null,
  spender: null,
  recipient: null,
  from: null,
  amount: null,
  unlimited: false,
  value: null,
  selector: null,
  knownRouter: null,
  expiration: null,
});

/**
 * Screen a transaction with local heuristics only. Pure: no network, no state.
 * @param input - Transaction fields.
 * @param input.chainId - CAIP-2 or hex chain ID.
 * @param input.to - Destination address.
 * @param input.data - Calldata.
 * @param input.value - Native value.
 * @param input.from - Sender address, if known.
 * @returns The local analysis.
 */
export function analyzeTransaction(input: {
  chainId: string;
  to?: string | null;
  data?: unknown;
  value?: unknown;
  from?: string | null;
}): Analysis {
  const chainNum = parseChainId(input.chainId);
  const chain = chainNum === null ? undefined : CHAINS[chainNum];
  const flags: Flag[] = [];
  let risk: RiskLevel = 'low';
  const flag = (id: string, severity: FlagSeverity, message: string): void => {
    flags.push({ id, severity, message });
    if (severity !== 'info') {
      risk = worst(risk, severity);
    }
  };
  const routerOf = (address: string): ReturnType<typeof knownRouter> => (chainNum === null ? null : knownRouter(chainNum, address));
  const native = chain?.native ?? 'native token';

  if (!chain) {
    flag('chain:not_covered', 'info', `Chain ${input.chainId} is not in the supported set; router list not applied.`);
  }

  const d = decodeTransaction({ to: input.to ?? null, data: input.data, value: input.value });
  let decoded: DecodedJson;

  switch (d.kind) {
    case 'native_transfer': {
      decoded = { ...emptyDecoded(d.kind, `Send ${native}`), recipient: d.to, value: d.value.toString(), amount: d.value.toString() };
      if (d.to === ZERO_ADDRESS) {
        flag('recipient:zero_address', 'high', 'Recipient is the zero address: funds sent there are unrecoverable.');
      }
      const router = routerOf(d.to);
      if (router) {
        decoded.knownRouter = router;
        flag('recipient:router', 'medium', `Plain ${native} transfer to the ${router} contract with no calldata: this is not how a swap is made.`);
      }
      break;
    }
    case 'approve': {
      const unlimited = isUnlimited(d.amount);
      const router = routerOf(d.spender);
      decoded = {
        ...emptyDecoded(d.kind, d.method === 'approve' ? 'Token approval (approve)' : 'Token approval (increaseAllowance)'),
        contract: d.token,
        token: d.token,
        spender: d.spender,
        amount: unlimited ? 'unlimited' : d.amount.toString(),
        unlimited,
        selector: d.method === 'approve' ? '0x095ea7b3' : '0x39509351',
        knownRouter: router,
      };
      if (d.amount === 0n && d.method === 'approve') {
        flag('approval:revoke', 'info', 'Sets the allowance to zero (revokes a previous approval).');
        break;
      }
      if (d.spender === ZERO_ADDRESS) {
        flag('approval:zero_spender', 'medium', 'Spender is the zero address.');
      }
      if (unlimited) {
        flag('approval:unlimited', 'high', 'Grants an unlimited allowance: the spender can move all of this token you hold, now and later.');
      }
      if (router) {
        flag('approval:known_router', 'info', `Spender is a known router: ${router}.`);
      } else {
        flag('approval:unknown_spender', 'medium', 'Spender is not a known router. Check that you trust this contract.');
      }
      break;
    }
    case 'set_approval_for_all': {
      decoded = {
        ...emptyDecoded(d.kind, d.approved ? 'Approve all NFTs (setApprovalForAll)' : 'Revoke NFT operator (setApprovalForAll)'),
        contract: d.token,
        token: d.token,
        spender: d.operator,
        amount: d.approved ? 'all tokens in the collection' : '0',
        unlimited: d.approved,
        selector: '0xa22cb465',
        knownRouter: routerOf(d.operator),
      };
      if (d.approved) {
        flag('approval:set_approval_for_all', 'high', 'Gives the operator control of every token in this collection. A common drainer pattern.');
      } else {
        flag('approval:revoke', 'info', 'Removes an operator approval.');
      }
      break;
    }
    case 'transfer': {
      decoded = {
        ...emptyDecoded(d.kind, 'Token transfer'),
        contract: d.token,
        token: d.token,
        recipient: d.recipient,
        amount: d.amount.toString(),
        selector: '0xa9059cbb',
      };
      if (d.recipient === ZERO_ADDRESS) {
        flag('recipient:zero_address', 'high', 'Recipient is the zero address: tokens sent there are unrecoverable.');
      } else if (d.recipient === d.token) {
        flag('recipient:token_contract', 'high', 'Recipient is the token contract itself: tokens sent there are usually unrecoverable.');
      }
      const router = routerOf(d.recipient);
      if (router) {
        decoded.knownRouter = router;
        flag('recipient:router', 'medium', `Direct token transfer to the ${router} contract: tokens sent this way are usually not recoverable.`);
      }
      break;
    }
    case 'transfer_from': {
      decoded = {
        ...emptyDecoded(d.kind, 'Token transfer (transferFrom)'),
        contract: d.token,
        token: d.token,
        from: d.from,
        recipient: d.recipient,
        amount: d.amount.toString(),
        selector: '0x23b872dd',
      };
      const sender = typeof input.from === 'string' ? input.from.toLowerCase() : null;
      if (sender && d.from !== sender) {
        flag('transfer_from:third_party', 'medium', 'Moves tokens out of a different address than the one signing.');
      }
      if (d.recipient === ZERO_ADDRESS) {
        flag('recipient:zero_address', 'high', 'Recipient is the zero address: tokens sent there are unrecoverable.');
      }
      break;
    }
    case 'permit2_approve': {
      const unlimited = d.amount >= PERMIT2_UNLIMITED_THRESHOLD;
      const router = routerOf(d.spender);
      decoded = {
        ...emptyDecoded(d.kind, 'Permit2 allowance (approve)'),
        contract: d.permit2,
        token: d.token,
        spender: d.spender,
        amount: unlimited ? 'unlimited' : d.amount.toString(),
        unlimited,
        selector: '0x87517c45',
        knownRouter: router,
        expiration: d.expiration.toString(),
      };
      if (d.permit2 !== PERMIT2) {
        flag('permit2:unknown_contract', 'medium', 'Called a Permit2-style approve on a contract that is not the canonical Permit2.');
      }
      if (d.amount === 0n) {
        flag('approval:revoke', 'info', 'Sets the Permit2 allowance to zero.');
        break;
      }
      if (unlimited) {
        flag('approval:unlimited', 'high', 'Grants an unlimited Permit2 allowance to the spender.');
      }
      if (router) {
        flag('approval:known_router', 'info', `Spender is a known router: ${router}.`);
      } else {
        flag('approval:unknown_spender', 'medium', 'Permit2 spender is not a known router. Check that you trust this contract.');
      }
      break;
    }
    case 'contract_call': {
      const router = routerOf(d.to);
      decoded = {
        ...emptyDecoded(d.kind, router ? `Call to ${router}` : 'Contract call'),
        contract: d.to,
        selector: d.selector,
        value: d.value.toString(),
        knownRouter: router,
      };
      if (router) {
        flag('call:known_router', 'info', `Destination is a known router: ${router}.`);
      } else {
        flag('call:not_decoded', 'medium', 'Calldata was not recognised. Review the contract and the dapp before signing.');
      }
      break;
    }
    case 'contract_creation': {
      decoded = { ...emptyDecoded(d.kind, 'Contract deployment'), value: d.value.toString() };
      flag('call:contract_creation', 'medium', 'This transaction deploys a new contract.');
      break;
    }
    case 'malformed':
    default: {
      decoded = { ...emptyDecoded('malformed', 'Unreadable transaction'), contract: d.kind === 'malformed' ? d.to : null };
      flag('tx:malformed', 'medium', d.kind === 'malformed' ? d.reason : 'Transaction could not be decoded.');
      break;
    }
  }

  return {
    chainId: chainNum === null ? String(input.chainId) : `eip155:${chainNum}`,
    chainName: chain?.name ?? null,
    supportedChain: Boolean(chain),
    riskLevel: risk,
    flags,
    decoded,
    disclosure: DISCLOSURE,
  };
}
