import { ALLOWED_ORIGINS } from './constants';

export const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_CHARS = 512 * 1024;

export type FetchResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; reason: 'blocked_origin' | 'timeout' | 'network' | 'bad_response'; status?: number };

/**
 * Check that a URL is https on one of the allowed Caelara origins.
 * @param url - The URL to check.
 * @returns True when the snap may contact it.
 */
export function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return false;
  }
  return ALLOWED_ORIGINS.includes(parsed.origin);
}

/**
 * The only network call in the snap. Refuses any URL outside the allowed origins, refuses redirects, applies a
 * timeout and never throws: every failure comes back as a value.
 * @param url - Target URL.
 * @param init - Request options.
 * @param init.method - HTTP method.
 * @param init.headers - Request headers.
 * @param init.body - JSON-serialisable request body.
 * @param timeoutMs - Abort after this many milliseconds.
 * @returns The parsed JSON response or a failure reason.
 */
export async function safeFetch(
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown },
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<FetchResult> {
  if (!isAllowedUrl(url)) {
    return { ok: false, reason: 'blocked_origin' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: { accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.headers ?? {}) },
      body: init.body === undefined ? null : JSON.stringify(init.body),
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) {
      return { ok: false, reason: 'bad_response', status: response.status };
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, reason: 'bad_response', status: response.status };
    }
    return { ok: true, status: response.status, json };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
