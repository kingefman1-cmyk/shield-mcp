/**
 * @jest-environment node
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { analyzeTransaction, parseChainId } from '../src/analyze';
import { decodeTransaction } from '../src/decode';
import { isAllowedUrl, safeFetch } from '../src/net';
import { shieldTxBody } from '../src/remote';
import { validateRoute } from '../src/rpc';

const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const EOA = '0x1234567890abcdef1234567890abcdef12345678';
const KYBER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const pad = (hex: string) => hex.replace(/^0x/u, '').padStart(64, '0');

describe('decode', () => {
  it('decodes approve, increaseAllowance, transfer, transferFrom', () => {
    expect(decodeTransaction({ to: TOKEN, data: `0x095ea7b3${pad(EOA)}${pad('0x64')}` })).toMatchObject({ kind: 'approve', spender: EOA, amount: 100n });
    expect(decodeTransaction({ to: TOKEN, data: `0x39509351${pad(EOA)}${pad('0x64')}` })).toMatchObject({ kind: 'approve', method: 'increaseAllowance' });
    expect(decodeTransaction({ to: TOKEN, data: `0xa9059cbb${pad(EOA)}${pad('0x1')}` })).toMatchObject({ kind: 'transfer', recipient: EOA, amount: 1n });
    expect(decodeTransaction({ to: TOKEN, data: `0x23b872dd${pad(EOA)}${pad(KYBER)}${pad('0x2')}` })).toMatchObject({ kind: 'transfer_from', from: EOA, recipient: KYBER });
  });

  it('treats malformed calldata as malformed, not as a crash', () => {
    expect(decodeTransaction({ to: TOKEN, data: '0x095ea7b3' }).kind).toBe('malformed');
    expect(decodeTransaction({ to: TOKEN, data: '0xzz' }).kind).toBe('malformed');
    expect(decodeTransaction({ to: 'not-an-address', data: '0x' }).kind).toBe('malformed');
    expect(decodeTransaction({ to: TOKEN, data: `0x095ea7b3${'f'.repeat(64)}${pad('0x1')}` }).kind).toBe('malformed');
  });

  it('decodes a simple Permit2 approve', () => {
    const data = `0x87517c45${pad(TOKEN)}${pad(KYBER)}${pad('0x' + 'f'.repeat(40))}${pad('0x6553f100')}`;
    expect(decodeTransaction({ to: PERMIT2, data })).toMatchObject({ kind: 'permit2_approve', token: TOKEN, spender: KYBER });
  });
});

describe('analyze', () => {
  it('parses chain IDs', () => {
    expect(parseChainId('eip155:8453')).toBe(8453);
    expect(parseChainId('0x38')).toBe(56);
    expect(parseChainId('solana:mainnet')).toBeNull();
  });

  it('marks unlimited approvals HIGH, including the 2^255 threshold', () => {
    const data = `0x095ea7b3${pad(KYBER)}${pad('0x8' + '0'.repeat(63))}`;
    const a = analyzeTransaction({ chainId: 'eip155:1', to: TOKEN, data });
    expect(a.riskLevel).toBe('high');
    expect(a.decoded.amount).toBe('unlimited');
  });

  it('marks an unlimited Permit2 allowance HIGH and a known exact one LOW', () => {
    const unlimited = `0x87517c45${pad(TOKEN)}${pad(KYBER)}${pad('0x' + 'f'.repeat(40))}${pad('0x1')}`;
    const exact = `0x87517c45${pad(TOKEN)}${pad(KYBER)}${pad('0x64')}${pad('0x1')}`;
    expect(analyzeTransaction({ chainId: 'eip155:1', to: PERMIT2, data: unlimited }).riskLevel).toBe('high');
    expect(analyzeTransaction({ chainId: 'eip155:1', to: PERMIT2, data: exact }).riskLevel).toBe('low');
  });

  it('marks approve(0) as a low-risk revocation', () => {
    const a = analyzeTransaction({ chainId: 'eip155:1', to: TOKEN, data: `0x095ea7b3${pad(EOA)}${pad('0x0')}` });
    expect(a.riskLevel).toBe('low');
    expect(a.flags[0]?.id).toBe('approval:revoke');
  });

  it('flags transfers to the zero address and third-party transferFrom', () => {
    expect(analyzeTransaction({ chainId: 'eip155:1', to: TOKEN, data: `0xa9059cbb${pad('0x0')}${pad('0x1')}` }).riskLevel).toBe('high');
    const tf = analyzeTransaction({ chainId: 'eip155:1', to: TOKEN, from: KYBER, data: `0x23b872dd${pad(EOA)}${pad(KYBER)}${pad('0x2')}` });
    expect(tf.riskLevel).toBe('medium');
  });

  it('marks unrecognised contract calls MEDIUM and known router calls LOW', () => {
    expect(analyzeTransaction({ chainId: 'eip155:1', to: EOA, data: '0xdeadbeef' }).riskLevel).toBe('medium');
    expect(analyzeTransaction({ chainId: 'eip155:56', to: KYBER, data: '0xdeadbeef' }).riskLevel).toBe('low');
    expect(analyzeTransaction({ chainId: 'eip155:56', to: '0x1906c1d672b88cd1b9ac7593301ca990f94eae07', data: '0x3593564c' }).decoded.knownRouter).toBe(
      'Uniswap Universal Router',
    );
  });

  it('always carries the disclosure', () => {
    expect(analyzeTransaction({ chainId: 'eip155:1', to: EOA, data: '0x' }).disclosure).toBe('Heuristic screening — will miss attacks');
  });
});

describe('remote body', () => {
  it('sends the token and destination only', () => {
    const a = analyzeTransaction({ chainId: 'eip155:8453', to: TOKEN, data: `0xa9059cbb${pad(EOA)}${pad('0x1')}` });
    expect(shieldTxBody(a, 'base')).toStrictEqual({ chain: 'base', token: TOKEN, destination: EOA });
  });
});

describe('route validation', () => {
  it('passes documented fields and rejects others', () => {
    expect(validateRoute({ fromChain: 'base', tokenIn: 'native', tokenOut: TOKEN, amount: '1', strictBlock: true })).toStrictEqual({
      fromChain: 'base',
      tokenIn: 'native',
      tokenOut: TOKEN,
      amount: '1',
      strictBlock: true,
    });
    expect(() => validateRoute({ fromChain: 'base', tokenIn: 'native', tokenOut: TOKEN, amount: '1', partnerBps: 10 })).toThrow('Unknown parameter');
    expect(() => validateRoute({ fromChain: 'base', tokenIn: 'native', tokenOut: TOKEN, amount: '0' })).toThrow('amount');
    expect(() => validateRoute({ fromChain: 'base', tokenIn: 'native', tokenOut: TOKEN, amount: '1', slippageBps: 501 })).toThrow('slippageBps');
    expect(() => validateRoute({ fromChain: 'tron', tokenIn: 'native', tokenOut: TOKEN, amount: '1' })).toThrow('fromChain');
  });
});

describe('network guard', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('allows only https Caelara origins', () => {
    expect(isAllowedUrl('https://shield.caelaralabs.com/v1/route/quote')).toBe(true);
    expect(isAllowedUrl('https://caelaralabs.com/shield/')).toBe(true);
    expect(isAllowedUrl('http://shield.caelaralabs.com/v1/route/quote')).toBe(false);
    expect(isAllowedUrl('https://shield.caelaralabs.com.evil.example/')).toBe(false);
    expect(isAllowedUrl('https://evil.example/?u=https://caelaralabs.com')).toBe(false);
    expect(isAllowedUrl('https://user@shield.caelaralabs.com/')).toBe(false);
    expect(isAllowedUrl('https://shield.caelaralabs.com:8443/')).toBe(false);
    expect(isAllowedUrl('not a url')).toBe(false);
  });

  it('never calls fetch for a blocked origin', async () => {
    const spy = jest.fn<typeof fetch>();
    globalThis.fetch = spy;
    expect(await safeFetch('https://evil.example/', { method: 'GET' })).toStrictEqual({ ok: false, reason: 'blocked_origin' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('times out without throwing', async () => {
    globalThis.fetch = ((_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    expect(await safeFetch('https://shield.caelaralabs.com/health', { method: 'GET' }, 50)).toStrictEqual({ ok: false, reason: 'timeout' });
  });

  it('returns network and bad-response failures as values', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await safeFetch('https://shield.caelaralabs.com/health', { method: 'GET' })).toStrictEqual({ ok: false, reason: 'network' });
    globalThis.fetch = (async () => new Response('<html>', { status: 502 })) as typeof fetch;
    expect(await safeFetch('https://shield.caelaralabs.com/health', { method: 'GET' })).toStrictEqual({ ok: false, reason: 'bad_response', status: 502 });
  });
});
