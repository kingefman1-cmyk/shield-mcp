// First-Call Fuel: a free trial key on first use, with no signup step.
// - Installation id: SHA-256 of "caelara-install-v1|" + hostname + "|" + username + "|" + home directory. Only the hash is
//   sent; the raw hostname, username and path never leave this machine. The server applies its own network rate limits and
//   returns the same key for the same installation (idempotent), so repeated starts never mint duplicates.
// - Storage: ~/.caelaralabs/credentials.json (directory 0700, file 0600 on POSIX systems; Windows does not enforce POSIX modes,
//   the file sits in the user profile). Never written into a project folder, never printed unmasked.
// - Opt out with CAELARA_NO_AUTO_TRIAL=1. A key in the environment always wins.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { dirname, join } from 'node:path'

export const TRIAL_URL = 'https://caelaralabs.com/api/trial-key'
export const KEY_RE = /^ck_(trial|live)_[A-Za-z0-9_-]{8,}$/
export const REFILL = {
  personal: 'https://caelaralabs.com/pay/personal',
  pricing: 'https://caelaralabs.com/#pricing',
  trial: 'https://caelaralabs.com/#trial',
}

export const mask = (key) => (typeof key === 'string' && key.length > 12 ? `${key.slice(0, 9)}****${key.slice(-4)}` : '****')

export function defaultIdentity(home = homedir()) {
  let username = ''
  try { username = userInfo().username } catch { username = process.env.USER || process.env.USERNAME || '' }
  return { hostname: hostname(), username, homedir: home }
}

export function installId({ hostname: h = '', username: u = '', homedir: d = '' } = {}) {
  return createHash('sha256').update(`caelara-install-v1|${h}|${u}|${d}`).digest('hex')
}

export const credentialsPath = (home = homedir()) => join(home, '.caelaralabs', 'credentials.json')

export function readCredentials(home = homedir(), now = Date.now()) {
  const file = credentialsPath(home)
  if (!existsSync(file)) return null
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'))
    if (!c || typeof c.key !== 'string' || !KEY_RE.test(c.key)) return null
    if (c.expires_at && Date.parse(c.expires_at) <= now) return null
    return c
  } catch {
    return null
  }
}

export function writeCredentials(home, { key, source, expires_at = null }, now = Date.now()) {
  const file = credentialsPath(home)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try { chmodSync(dirname(file), 0o700) } catch { /* not supported on this file system */ }
  const rec = { version: 1, key, source, created: new Date(now).toISOString(), expires_at: expires_at || null }
  writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* not supported on this file system */ }
  return file
}

// POST the installation id. Returns { key, reused, calls_remaining, expires_at } or { error, status, message, refuel }.
export async function provision({ fetch: doFetch = globalThis.fetch, identity, url } = {}) {
  const target = url || process.env.CAELARA_TRIAL_URL || TRIAL_URL
  let res
  try {
    res = await doFetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CaelaraLabs-Engine/1.0' },
      body: JSON.stringify({ install_id: installId(identity) }),
    })
  } catch {
    return { error: 'network', status: 0, message: 'caelaralabs.com did not answer.' }
  }
  const body = await res.json().catch(() => ({}))
  if ((res.status === 201 || res.status === 200) && typeof body.key === 'string' && KEY_RE.test(body.key)) {
    return { key: body.key, reused: body.reused === true || res.status === 200, calls_remaining: body.calls_remaining ?? null, expires_at: body.expires_at ?? null }
  }
  return { error: body.error || 'trial_unavailable', status: res.status, message: body.message || `HTTP ${res.status}`, refuel: body.refuel || { links: REFILL } }
}

// Lazy key resolver for the server: env key > stored credentials > First-Call Fuel > none.
// get() never throws and runs provisioning at most once per process.
export function createKeyResolver({ env = process.env, envName, home = homedir(), identity, fetch: doFetch, log = () => {}, now = () => Date.now() } = {}) {
  let pending = null
  let last = null
  async function resolveOnce() {
    const stored = readCredentials(home, now())
    if (stored) return stored.key
    if (env.CAELARA_NO_AUTO_TRIAL === '1') return null
    const r = await provision({ fetch: doFetch, identity: identity || defaultIdentity(home) })
    if (r.key) {
      writeCredentials(home, { key: r.key, source: 'install', expires_at: r.expires_at })
      log(`Caelara: free trial key ready (${mask(r.key)}${r.calls_remaining != null ? `, ${r.calls_remaining} calls` : ''}), stored in ${credentialsPath(home)}.`)
      return r.key
    }
    last = r
    log(`Caelara: no trial key (${r.message}). Calls answer with x402 pay-per-call terms; refill at ${REFILL.personal}.`)
    return null
  }
  return {
    async get() {
      const fromEnv = env[envName]
      if (fromEnv) return fromEnv
      if (!pending) pending = resolveOnce().catch(() => null)
      return pending
    },
    lastError: () => last,
  }
}
