// Test-only network stub, loaded inside the snap worker thread before the execution environment starts.
// It answers the Caelara endpoints from fixtures chosen by the request, and fails anything else.
'use strict';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ROUTE_RISK = { riskLevel: 'high', flags: ['base:0x1111111111111111111111111111111111111111 screened as high risk'], disclosure: 'Heuristic screening — will miss attacks' };

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const headers = new Headers(init.headers || {});
  const key = headers.get('x-caelara-key') || '';
  const body = init.body ? JSON.parse(init.body) : {};

  if (url === 'https://shield.caelaralabs.com/v1/shield/tx') {
    if (key.includes('netfail')) throw new TypeError('fetch failed');
    if (key.includes('pay402')) return json(402, { x402Version: 1, error: 'X-PAYMENT header is required' });
    if (key.includes('verdictblock')) {
      return json(200, {
        verdict: 'block',
        findings: [{ id: 'token:honeypot', category: 'token', severity: 'high', detail: 'Token cannot be sold' }],
        partial: false,
      });
    }
    return json(200, { verdict: 'allow', findings: [], partial: false });
  }
  if (url === 'https://shield.caelaralabs.com/v1/route/quote' || url === 'https://shield.caelaralabs.com/v1/route/build') {
    if (body.strictBlock === true) {
      return json(422, {
        ok: false,
        error: 'policy_blocked',
        policy: 'strictBlock',
        message: 'strictBlock is on and this route has riskLevel high. No quote or transaction was built.',
        risk: ROUTE_RISK,
        screening: { verdict: 'block', tokens: [] },
      });
    }
    return json(200, {
      ok: true,
      provider: 'velora',
      kind: 'swap',
      selectedMidpoint: 'velora',
      layer: 1,
      candidatesEvaluated: 2,
      estimatedAmountOut: '990000',
      minAmountOut: '985050',
      fee: { bps: 50, percent: 0.5 },
      risk: ROUTE_RISK,
      policy: { strictBlock: false },
      screening: { verdict: 'block', tokens: [] },
      warnings: [],
    });
  }
  throw new TypeError('test stub: unexpected URL ' + url);
};
