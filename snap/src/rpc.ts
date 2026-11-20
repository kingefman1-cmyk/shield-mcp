import { InvalidParamsError, UnauthorizedError } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/snaps-sdk';

import { analyzeTransaction, parseChainId } from './analyze';
import { API_BASE, API_KEY_PATTERN, DISCLOSURE, FEE_DISCLOSURE, KEY_ADMIN_ORIGIN } from './constants';
import { EVM_ADDRESS } from './decode';
import { safeFetch } from './net';
import { clearApiKey, getApiKey, setApiKey } from './state';

const ROUTE_CHAINS = ['solana', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bnb'];
const ROUTE_KEYS = new Set(['fromChain', 'toChain', 'tokenIn', 'tokenOut', 'amount', 'slippageBps', 'taker', 'recipient', 'strictBlock']);
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const AMOUNT = /^[1-9][0-9]{0,38}$/u;
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/u;
const HEX_OR_DEC = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/u;
const MAX_DATA_CHARS = 131_072;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reject params that carry keys outside an allowed set.
 * @param params - The params object.
 * @param allowed - Allowed keys.
 */
function onlyKeys(params: Record<string, unknown>, allowed: Set<string>): void {
  for (const k of Object.keys(params)) {
    if (!allowed.has(k)) {
      throw new InvalidParamsError(`Unknown parameter: ${k.slice(0, 40)}`);
    }
  }
}

const objectParams = (params: unknown): Record<string, unknown> => {
  if (!isPlainObject(params)) {
    throw new InvalidParamsError('params must be an object');
  }
  return params;
};

/**
 * caelara_screenTransaction: local analysis only. Remote screening (which spends the user's key) runs only inside
 * MetaMask's own transaction insight, never on a dapp's request.
 * @param rawParams - Request params.
 * @returns The analysis as JSON.
 */
export function screenTransaction(rawParams: unknown): Json {
  const params = objectParams(rawParams);
  onlyKeys(params, new Set(['chainId', 'to', 'data', 'value', 'from']));
  if (parseChainId(params.chainId) === null) {
    throw new InvalidParamsError('chainId must be a CAIP-2 eip155 chain ID (for example eip155:1) or a hex chain ID');
  }
  if (typeof params.to !== 'string' || !EVM_ADDRESS.test(params.to)) {
    throw new InvalidParamsError('to must be an EVM address');
  }
  if (params.data !== undefined && (typeof params.data !== 'string' || !HEX_DATA.test(params.data) || params.data.length > MAX_DATA_CHARS)) {
    throw new InvalidParamsError('data must be 0x-prefixed hex bytes');
  }
  if (params.value !== undefined && (typeof params.value !== 'string' || !HEX_OR_DEC.test(params.value))) {
    throw new InvalidParamsError('value must be a hex quantity or a decimal integer string');
  }
  if (params.from !== undefined && (typeof params.from !== 'string' || !EVM_ADDRESS.test(params.from))) {
    throw new InvalidParamsError('from must be an EVM address');
  }
  const a = analyzeTransaction({
    chainId: params.chainId as string,
    to: params.to,
    data: params.data,
    value: params.value,
    from: params.from ?? null,
  });
  return {
    chainId: a.chainId,
    supportedChain: a.supportedChain,
    riskLevel: a.riskLevel,
    flags: a.flags,
    decoded: a.decoded,
    remote: { status: 'not_run', reason: 'Remote screening runs only in the MetaMask transaction insight.' },
    disclosure: DISCLOSURE,
  } as unknown as Json;
}

const tokenOk = (v: unknown): boolean => typeof v === 'string' && (v === 'native' || EVM_ADDRESS.test(v) || SOLANA_ADDRESS.test(v));
const walletOk = (v: unknown): boolean => typeof v === 'string' && (EVM_ADDRESS.test(v) || SOLANA_ADDRESS.test(v));

/**
 * Validate a route request and return a body holding only the documented fields.
 * @param rawParams - Request params.
 * @returns The sanitised body.
 */
export function validateRoute(rawParams: unknown): Record<string, Json> {
  const p = objectParams(rawParams);
  onlyKeys(p, ROUTE_KEYS);
  if (typeof p.fromChain !== 'string' || !ROUTE_CHAINS.includes(p.fromChain)) {
    throw new InvalidParamsError(`fromChain must be one of ${ROUTE_CHAINS.join('|')}`);
  }
  if (p.toChain !== undefined && (typeof p.toChain !== 'string' || !ROUTE_CHAINS.includes(p.toChain))) {
    throw new InvalidParamsError(`toChain must be one of ${ROUTE_CHAINS.join('|')}`);
  }
  if (!tokenOk(p.tokenIn)) {
    throw new InvalidParamsError('tokenIn must be "native", a 0x address or a Solana mint');
  }
  if (!tokenOk(p.tokenOut)) {
    throw new InvalidParamsError('tokenOut must be "native", a 0x address or a Solana mint');
  }
  if (typeof p.amount !== 'string' || !AMOUNT.test(p.amount)) {
    throw new InvalidParamsError('amount must be a positive integer string in the smallest unit');
  }
  if (p.slippageBps !== undefined && (typeof p.slippageBps !== 'number' || !Number.isInteger(p.slippageBps) || p.slippageBps < 1 || p.slippageBps > 500)) {
    throw new InvalidParamsError('slippageBps must be an integer from 1 to 500');
  }
  for (const k of ['taker', 'recipient'] as const) {
    if (p[k] !== undefined && !walletOk(p[k])) {
      throw new InvalidParamsError(`${k} must be an EVM or Solana address`);
    }
  }
  if (p.strictBlock !== undefined && typeof p.strictBlock !== 'boolean') {
    throw new InvalidParamsError('strictBlock must be a boolean');
  }
  const body: Record<string, Json> = {};
  for (const k of ROUTE_KEYS) {
    if (p[k] !== undefined) {
      body[k] = p[k] as Json;
    }
  }
  return body;
}

/**
 * Call POST /v1/route/quote or /v1/route/build. The response is returned as a result, including structured errors
 * such as 422 policy_blocked; the snap never signs anything.
 * @param kind - quote or build.
 * @param rawParams - Request params.
 * @returns The API response or a structured error.
 */
export async function route(kind: 'quote' | 'build', rawParams: unknown): Promise<Json> {
  const body = validateRoute(rawParams);
  if (kind === 'build' && body.taker === undefined) {
    throw new InvalidParamsError('taker is required to build a route');
  }
  const res = await safeFetch(`${API_BASE}/v1/route/${kind}`, { method: 'POST', body });
  if (!res.ok) {
    return { ok: false, error: 'unreachable', message: 'Shield API unreachable.', disclosure: DISCLOSURE, feeDisclosure: FEE_DISCLOSURE };
  }
  const json = isPlainObject(res.json) ? res.json : {};
  if (res.status === 200) {
    return { ...(json as Record<string, Json>), signed: false, disclosure: DISCLOSURE, feeDisclosure: FEE_DISCLOSURE };
  }
  const out: Record<string, Json> = {
    ok: false,
    httpStatus: res.status,
    error: typeof json.error === 'string' ? json.error : 'request_failed',
    message: typeof json.message === 'string' ? json.message : 'The route request failed.',
    disclosure: DISCLOSURE,
    feeDisclosure: FEE_DISCLOSURE,
  };
  if (json.policy !== undefined) {
    out.policy = json.policy as Json;
  }
  if (json.risk !== undefined) {
    out.risk = json.risk as Json;
  }
  return out;
}

/**
 * Throw unless the request came from the Caelara site.
 * @param origin - Request origin.
 */
function requireAdminOrigin(origin: string): void {
  if (origin !== KEY_ADMIN_ORIGIN) {
    throw new UnauthorizedError(`This method can only be called from ${KEY_ADMIN_ORIGIN}`);
  }
}

/**
 * caelara_setApiKey.
 * @param origin - Request origin.
 * @param rawParams - Request params.
 * @returns Confirmation without the key.
 */
export async function setKey(origin: string, rawParams: unknown): Promise<Json> {
  requireAdminOrigin(origin);
  const p = objectParams(rawParams);
  onlyKeys(p, new Set(['key']));
  if (typeof p.key !== 'string' || !API_KEY_PATTERN.test(p.key)) {
    throw new InvalidParamsError('key must match ck_live_... or ck_trial_... (lower-case letters and digits)');
  }
  await setApiKey(p.key);
  return { keyConfigured: true };
}

/**
 * caelara_clearApiKey.
 * @param origin - Request origin.
 * @returns Confirmation.
 */
export async function clearKey(origin: string): Promise<Json> {
  requireAdminOrigin(origin);
  await clearApiKey();
  return { keyConfigured: false };
}

/**
 * caelara_getStatus. Never returns the key itself.
 * @returns Whether a key is stored.
 */
export async function status(): Promise<Json> {
  return { keyConfigured: (await getApiKey()) !== null };
}
