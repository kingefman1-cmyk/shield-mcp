import type { Analysis, Flag, RiskLevel } from './analyze';
import { API_BASE, CHAINS, NOTE_ADD_KEY, NOTE_UNREACHABLE } from './constants';
import { EVM_ADDRESS } from './decode';
import { safeFetch } from './net';

export type RemoteStatus = 'checked' | 'partial' | 'no_key' | 'not_authorized' | 'unreachable' | 'unsupported_chain' | 'nothing_to_check' | 'rejected';

export type RemoteResult = {
  status: RemoteStatus;
  note: string | null;
  riskLevel: RiskLevel | null;
  flags: Flag[];
};

const VERDICT_RISK: Record<string, RiskLevel> = { allow: 'low', review: 'medium', block: 'high' };
const SEVERITIES = new Set(['low', 'medium', 'high']);

/**
 * Build the POST /v1/shield/tx body for an analysed transaction.
 * @param analysis - The local analysis.
 * @param shieldChain - Chain name accepted by the API.
 * @returns The request body, or null when there is nothing to check remotely.
 */
export function shieldTxBody(analysis: Analysis, shieldChain: string): Record<string, string> | null {
  const d = analysis.decoded;
  const body: Record<string, string> = { chain: shieldChain };
  if (d.token && EVM_ADDRESS.test(d.token)) {
    body.token = d.token.toLowerCase();
  }
  const destination = d.recipient ?? d.spender;
  if (destination && EVM_ADDRESS.test(destination)) {
    body.destination = destination.toLowerCase();
  }
  return body.token || body.destination ? body : null;
}

/**
 * Run the paid remote check for a transaction. Never throws.
 * @param analysis - The local analysis.
 * @param apiKey - The user's stored key, or null.
 * @returns The remote result, including a user-facing note when it could not run.
 */
export async function screenRemote(analysis: Analysis, apiKey: string | null): Promise<RemoteResult> {
  const none = (status: RemoteStatus, note: string | null): RemoteResult => ({ status, note, riskLevel: null, flags: [] });
  if (!apiKey) {
    return none('no_key', NOTE_ADD_KEY);
  }
  const chainNum = Number(analysis.chainId.replace('eip155:', ''));
  const shieldChain = CHAINS[chainNum]?.shieldChain ?? null;
  if (!shieldChain) {
    return none('unsupported_chain', `Remote screening does not cover ${analysis.chainName ?? analysis.chainId} yet: showing local checks only.`);
  }
  const body = shieldTxBody(analysis, shieldChain);
  if (!body) {
    return none('nothing_to_check', null);
  }

  const res = await safeFetch(`${API_BASE}/v1/shield/tx`, { method: 'POST', headers: { 'X-Caelara-Key': apiKey }, body });
  if (!res.ok) {
    return none('unreachable', NOTE_UNREACHABLE);
  }
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    return none('not_authorized', NOTE_ADD_KEY);
  }
  if (res.status === 400 || res.status === 422) {
    return none('rejected', 'Remote screening could not check this transaction: showing local checks only.');
  }
  if (res.status !== 200 || !res.json || typeof res.json !== 'object') {
    return none('unreachable', NOTE_UNREACHABLE);
  }

  const data = res.json as Record<string, unknown>;
  const flags: Flag[] = [];
  const findings = Array.isArray(data.findings) ? data.findings.slice(0, 20) : [];
  for (const f of findings) {
    if (!f || typeof f !== 'object') {
      continue;
    }
    const finding = f as Record<string, unknown>;
    const severity = typeof finding.severity === 'string' && SEVERITIES.has(finding.severity) ? (finding.severity as RiskLevel) : 'medium';
    const id = typeof finding.id === 'string' ? finding.id.slice(0, 80) : 'finding';
    const detail = typeof finding.detail === 'string' ? finding.detail.slice(0, 200) : id;
    flags.push({ id: `remote:${id}`, severity, message: `Shield API: ${detail}` });
  }
  const verdict = typeof data.verdict === 'string' ? data.verdict : '';
  const riskLevel = VERDICT_RISK[verdict] ?? 'medium';
  const partial = data.partial === true;
  return {
    status: partial ? 'partial' : 'checked',
    note: partial ? 'Shield API returned a partial result: some remote checks could not run.' : null,
    riskLevel,
    flags,
  };
}

/**
 * Merge a remote result into a local analysis.
 * @param analysis - The local analysis.
 * @param remote - The remote result.
 * @returns The combined analysis.
 */
export function mergeRemote(analysis: Analysis, remote: RemoteResult): Analysis {
  if (!remote.riskLevel) {
    return analysis;
  }
  const rank = { low: 1, medium: 2, high: 3 } as const;
  const riskLevel = rank[remote.riskLevel] > rank[analysis.riskLevel] ? remote.riskLevel : analysis.riskLevel;
  return { ...analysis, riskLevel, flags: [...analysis.flags, ...remote.flags] };
}
