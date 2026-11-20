import { describe, expect, it } from '@jest/globals';
import { installSnap } from '@metamask/snaps-jest';

import { StubbedNetworkExecutionService } from './support/stub-service';

const DISCLOSURE = 'Heuristic screening — will miss attacks';
const ADMIN = 'https://caelaralabs.com';
const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const;
const EOA = '0x1234567890abcdef1234567890abcdef12345678' as const;
const VELORA = '0x6a000f20005980200259b80c5102003040001068' as const;
const UNIVERSAL_ROUTER_BASE = '0x6ff5693b99212da76ad316178a184ab56d299b43' as const;
const MAX = 'f'.repeat(64);

const pad = (hex: string) => hex.replace(/^0x/u, '').padStart(64, '0');
const approve = (spender: string, amountHex: string): `0x${string}` => `0x095ea7b3${pad(spender)}${pad(amountHex)}`;

const start = async () => installSnap({ executionService: StubbedNetworkExecutionService as any });

const uiText = async (response: any): Promise<string> => {
  const ui = await response.getInterface();
  return JSON.stringify(ui.content);
};

const setKey = async (request: any, key: string) => {
  const r = await request({ method: 'caelara_setApiKey', origin: ADMIN, params: { key } });
  expect(r).toRespondWith({ keyConfigured: true });
};

describe('onTransaction', () => {
  it.each([
    ['eip155:1', 'ETH'],
    ['eip155:56', 'BNB'],
    ['eip155:137', 'POL'],
  ])('shows a native transfer insight on %s', async (chainId, symbol) => {
    const { onTransaction } = await start();
    const response = await onTransaction({ chainId, to: EOA, value: '0xde0b6b3a7640000', data: '0x' });
    const text = await uiText(response);
    expect(text).toContain('LOW RISK');
    expect(text).toContain(`Send ${symbol}`);
    expect(text).toContain('1000000000000000000');
    expect(text).toContain(DISCLOSURE);
    expect(text).toContain('Remote screening unavailable: add a free trial key at https://caelaralabs.com/shield/');
  });

  it('flags an unlimited ERC-20 approval as HIGH RISK with critical severity', async () => {
    const { onTransaction } = await start();
    const response: any = await onTransaction({ chainId: 'eip155:1', to: TOKEN, data: approve(EOA, MAX) });
    const text = await uiText(response);
    expect(text).toContain('HIGH RISK');
    expect(text).toContain('unlimited');
    expect(text).toContain('Spender is not a known router');
    expect(text).toContain(DISCLOSURE);
    expect(response.response.result.severity).toBe('critical');
  });

  it('rates an exact approval to a known router as LOW RISK', async () => {
    const { onTransaction } = await start();
    const response: any = await onTransaction({ chainId: 'eip155:8453', to: TOKEN, data: approve(VELORA, '0xf4240') });
    const text = await uiText(response);
    expect(text).toContain('LOW RISK');
    expect(text).toContain('Velora Augustus v6');
    expect(text).toContain('1000000');
    expect(text).toContain(DISCLOSURE);
    expect(response.response.result.severity).toBeUndefined();
  });

  it('rates an exact approval to an unknown spender as MEDIUM RISK', async () => {
    const { onTransaction } = await start();
    const response = await onTransaction({ chainId: 'eip155:42161', to: TOKEN, data: approve(EOA, '0xf4240') });
    const text = await uiText(response);
    expect(text).toContain('MEDIUM RISK');
    expect(text).toContain(DISCLOSURE);
  });

  it('rates a swap call to a known router as LOW RISK', async () => {
    const { onTransaction } = await start();
    const response = await onTransaction({ chainId: 'eip155:8453', to: UNIVERSAL_ROUTER_BASE, data: `0x3593564c${'00'.repeat(96)}`, value: '0x0' });
    const text = await uiText(response);
    expect(text).toContain('LOW RISK');
    expect(text).toContain('Uniswap Universal Router');
    expect(text).toContain(DISCLOSURE);
  });

  it('shows the trial-key note on a 402 from the remote check and still renders the local result', async () => {
    const { onTransaction, request } = await start();
    await setKey(request, 'ck_trial_pay402aaaaaaaaaaaa');
    const response = await onTransaction({ chainId: 'eip155:1', to: TOKEN, data: approve(EOA, MAX) });
    const text = await uiText(response);
    expect(text).toContain('HIGH RISK');
    expect(text).toContain('Remote screening unavailable: add a free trial key at https://caelaralabs.com/shield/');
    expect(text).toContain(DISCLOSURE);
  });

  it('shows an unreachable note on a network failure and still renders the local result', async () => {
    const { onTransaction, request } = await start();
    await setKey(request, 'ck_trial_netfailaaaaaaaaaaa');
    const response = await onTransaction({ chainId: 'eip155:8453', to: TOKEN, data: approve(VELORA, '0xf4240') });
    const text = await uiText(response);
    expect(text).toContain('LOW RISK');
    expect(text).toContain('Shield API unreachable');
    expect(text).toContain(DISCLOSURE);
  });

  it('merges a remote block verdict into the banner', async () => {
    const { onTransaction, request } = await start();
    await setKey(request, 'ck_live_verdictblockaaaaaaa');
    const response: any = await onTransaction({ chainId: 'eip155:8453', to: TOKEN, data: approve(VELORA, '0xf4240') });
    const text = await uiText(response);
    expect(text).toContain('HIGH RISK');
    expect(text).toContain('Shield API: Token cannot be sold');
    expect(text).toContain(DISCLOSURE);
    expect(response.response.result.severity).toBe('critical');
  });

  it('flags setApprovalForAll(true) as HIGH RISK', async () => {
    const { onTransaction } = await start();
    const data: `0x${string}` = `0xa22cb465${pad(EOA)}${pad('0x1')}`;
    const text = await uiText(await onTransaction({ chainId: 'eip155:1', to: TOKEN, data }));
    expect(text).toContain('HIGH RISK');
    expect(text).toContain(DISCLOSURE);
  });
});

describe('onRpcRequest', () => {
  const route = { fromChain: 'base', tokenIn: 'native', tokenOut: TOKEN, amount: '1000000000000000' };

  it('quotes a route with strictBlock false and surfaces the risk', async () => {
    const { request } = await start();
    const response: any = await request({ method: 'caelara_quoteScreenedRoute', origin: 'https://dapp.example', params: { ...route, strictBlock: false } });
    const result = response.response.result;
    expect(result.ok).toBe(true);
    expect(result.risk.riskLevel).toBe('high');
    expect(result.signed).toBe(false);
    expect(result.feeDisclosure).toBe('Route quotes include a 0.50% (50 bps) protocol fee');
    expect(result.disclosure).toBe(DISCLOSURE);
  });

  it('returns policy_blocked as a structured result with strictBlock true', async () => {
    const { request } = await start();
    const response: any = await request({ method: 'caelara_quoteScreenedRoute', origin: 'https://dapp.example', params: { ...route, strictBlock: true } });
    expect(response).toRespondWith(
      expect.objectContaining({ ok: false, httpStatus: 422, error: 'policy_blocked', policy: 'strictBlock', feeDisclosure: 'Route quotes include a 0.50% (50 bps) protocol fee', risk: expect.objectContaining({ riskLevel: 'high' }) }),
    );
  });

  it('rejects unknown route fields', async () => {
    const { request } = await start();
    const response: any = await request({ method: 'caelara_quoteScreenedRoute', params: { ...route, partnerWallet: EOA } });
    expect(response.response.error.code).toBe(-32602);
  });

  it('requires taker to build', async () => {
    const { request } = await start();
    const response: any = await request({ method: 'caelara_buildScreenedRoute', params: route });
    expect(response.response.error.code).toBe(-32602);
  });

  it('screens a transaction for a dapp and returns JSON', async () => {
    const { request } = await start();
    const response: any = await request({ method: 'caelara_screenTransaction', origin: 'https://dapp.example', params: { chainId: 'eip155:1', to: TOKEN, data: approve(EOA, MAX), value: '0x0' } });
    const result = response.response.result;
    expect(result.riskLevel).toBe('high');
    expect(result.decoded.amount).toBe('unlimited');
    expect(result.decoded.spender).toBe(EOA);
    expect(result.flags.map((f: any) => f.id)).toContain('approval:unlimited');
    expect(result.disclosure).toBe(DISCLOSURE);
  });

  it('rejects setApiKey from any origin other than https://caelaralabs.com', async () => {
    const { request } = await start();
    for (const origin of ['https://evil.example', 'http://caelaralabs.com', 'https://shield.caelaralabs.com', 'https://caelaralabs.com.evil.example']) {
      const response: any = await request({ method: 'caelara_setApiKey', origin, params: { key: 'ck_trial_aaaaaaaaaaaaaaaa' } });
      expect(response.response.error.code).toBe(4100);
    }
    expect(await request({ method: 'caelara_getStatus' })).toRespondWith({ keyConfigured: false });
  });

  it('validates the key format and never returns the key', async () => {
    const { request } = await start();
    const bad: any = await request({ method: 'caelara_setApiKey', origin: ADMIN, params: { key: 'sk_live_123' } });
    expect(bad.response.error.code).toBe(-32602);
    await setKey(request, 'ck_live_0123456789abcdef');
    const status: any = await request({ method: 'caelara_getStatus' });
    expect(status).toRespondWith({ keyConfigured: true });
    expect(JSON.stringify(status.response)).not.toContain('ck_live');
    const denied: any = await request({ method: 'caelara_clearApiKey', origin: 'https://evil.example' });
    expect(denied.response.error.code).toBe(4100);
    expect(await request({ method: 'caelara_clearApiKey', origin: ADMIN })).toRespondWith({ keyConfigured: false });
    expect(await request({ method: 'caelara_getStatus' })).toRespondWith({ keyConfigured: false });
  });

  it('returns MethodNotFound for unknown methods', async () => {
    const { request } = await start();
    const response: any = await request({ method: 'caelara_signSomething' });
    expect(response.response.error.code).toBe(-32601);
  });
});
