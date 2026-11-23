// npx @caelaralabs/shield-mcp init [--email you@company.com] [--config <path>] [--dry-run] [--no-verify]
// First-Call Fuel: gets a free ck_trial_ key (50 calls, 7 days, no card) for this installation, or with --email for that
// address, and stores it in ~/.caelaralabs/credentials.json (0600). Then writes the MCP server entry into an MCP client config
// file (default ~/.cursor/mcp.json, or any mcpServers JSON file with --config) and checks that the Shield host answers.
// The client config never contains the key: the server reads the credentials file. The terminal shows the key masked.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { credentialsPath, defaultIdentity, mask, provision, readCredentials, writeCredentials, TRIAL_URL, KEY_RE, REFILL } from './fuel.mjs'

export { mask, TRIAL_URL }
export const SERVER_NAME = 'caelara-shield'
export const KEY_ENV = 'CAELARA_KEY'
export const VERIFY_URL = 'https://shield.caelaralabs.com/health'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const defaultConfigPath = ({ home = homedir() } = {}) => join(home, '.cursor', 'mcp.json')

export function parseArgs(argv) {
  const o = { config: null, dryRun: false, verify: true, email: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') o.dryRun = true
    else if (a === '--no-verify') o.verify = false
    else if (a === '--email') o.email = argv[++i] ?? null
    else if (a.startsWith('--email=')) o.email = a.slice(8)
    else if (a === '--config') o.config = argv[++i] ?? ''
    else if (a.startsWith('--config=')) o.config = a.slice(9)
    else return { error: `unknown option ${a}` }
  }
  if (o.config !== null && !o.config) return { error: '--config needs a file path' }
  return o
}

// The client entry carries no key: the server finds it in ~/.caelaralabs/credentials.json (or CAELARA_KEY).
export function mergeConfig(existing) {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {}
  cfg.mcpServers = { ...(cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {}) }
  cfg.mcpServers[SERVER_NAME] = { command: 'npx', args: ['-y', '@caelaralabs/shield-mcp'] }
  return cfg
}

export async function runInit(argv = [], io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'))
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'))
  const env = io.env ?? process.env
  const doFetch = io.fetch ?? globalThis.fetch
  const home = io.paths?.home ?? homedir()
  const o = parseArgs(argv)
  if (o.error) { err(`init: ${o.error}`); return 2 }
  if (o.email !== null && !EMAIL.test(o.email)) { err('init: --email needs a valid address.'); return 2 }

  let key = null
  let store = null // { key, source, expires_at } to write unless this is a dry run
  const stored = readCredentials(home)
  if (env[KEY_ENV]) {
    key = env[KEY_ENV]
    out(`Using the key already set in ${KEY_ENV} (${mask(key)}).`)
    if (!stored || stored.key !== key) store = { key, source: 'manual', expires_at: null }
  } else if (stored) {
    key = stored.key
    out(`Using your saved key (${mask(key)}) from ${credentialsPath(home)}.`)
  } else if (o.dryRun) {
    // A dry run never contacts the trial service: nothing is created.
    out(o.email ? '[dry run] would request a free trial key for ' + o.email : '[dry run] would request a free trial key for this installation')
  } else if (o.email) {
    try {
      const res = await doFetch(TRIAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'CaelaraLabs-Engine/1.0' }, body: JSON.stringify({ email: o.email }) })
      const body = await res.json().catch(() => ({}))
      if (res.status !== 201 || typeof body.key !== 'string' || !KEY_RE.test(body.key)) { err(`init: could not get a trial key (HTTP ${res.status}). ${body.message || ''}`.trim()); return 1 }
      key = body.key
      store = { key, source: 'email', expires_at: body.expires_at ?? null }
      out(`Trial key issued: ${mask(key)} (${body.calls_remaining ?? 50} calls).`)
    } catch { err('init: caelaralabs.com did not answer. Check your connection and try again.'); return 1 }
  } else {
    const r = await provision({ fetch: doFetch, identity: io.identity ?? defaultIdentity(home) })
    if (!r.key) {
      err(`init: could not get a free trial key (${r.status ? `HTTP ${r.status}` : 'no answer'}). ${r.message || ''}`.trim())
      err(`Refill or upgrade: ${REFILL.personal} · pricing ${REFILL.pricing} · or pay per call with x402.`)
      return 1
    }
    key = r.key
    store = { key, source: 'install', expires_at: r.expires_at }
    out(`${r.reused ? 'Free trial key for this installation restored' : 'Free trial key issued'}: ${mask(key)}${r.calls_remaining != null ? ` (${r.calls_remaining} calls)` : ''}.`)
  }

  const file = o.config ? resolve(o.config) : defaultConfigPath({ home })
  let existing = {}
  if (existsSync(file)) {
    try { existing = JSON.parse(readFileSync(file, 'utf8')) } catch { err(`init: ${file} is not valid JSON; fix or move it, then run init again.`); return 1 }
  }
  const next = mergeConfig(existing)
  if (o.dryRun) {
    if (store) out(`[dry run] would store the key in ${credentialsPath(home)}`)
    out(`[dry run] would write ${file} (server "${SERVER_NAME}")`)
  } else {
    if (store) out(`Stored the key in ${writeCredentials(home, store)} (readable by you only).`)
    if (existsSync(file)) copyFileSync(file, `${file}.bak`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    out(`Wrote ${file} (server "${SERVER_NAME}").`)
  }

  if (o.verify) {
    try {
      const res = await doFetch(VERIFY_URL, { headers: { 'User-Agent': 'CaelaraLabs-Engine/1.0' } })
      out(res.ok ? `Connectivity check passed: ${VERIFY_URL} answered HTTP ${res.status}.` : `Connectivity check: ${VERIFY_URL} answered HTTP ${res.status}.`)
      if (!res.ok) return 1
    } catch { err(`Connectivity check failed: ${VERIFY_URL} did not answer.`); return 1 }
  }
  out('Done. Restart your MCP client to load the server.')
  return 0
}
