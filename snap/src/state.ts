import { API_KEY_PATTERN } from './constants';

// The only thing the snap stores: the user's own optional Caelara API key, in MetaMask's encrypted snap state.

/**
 * Read the stored API key.
 * @returns The key, or null when none is stored or state cannot be read.
 */
export async function getApiKey(): Promise<string | null> {
  try {
    const state = await snap.request({ method: 'snap_manageState', params: { operation: 'get', encrypted: true } });
    const key = state && typeof state === 'object' ? (state as Record<string, unknown>).apiKey : undefined;
    return typeof key === 'string' && API_KEY_PATTERN.test(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * Store the API key (already validated by the caller).
 * @param key - The API key.
 */
export async function setApiKey(key: string): Promise<void> {
  await snap.request({ method: 'snap_manageState', params: { operation: 'update', newState: { apiKey: key }, encrypted: true } });
}

/**
 * Remove the stored API key.
 */
export async function clearApiKey(): Promise<void> {
  await snap.request({ method: 'snap_manageState', params: { operation: 'clear', encrypted: true } });
}
