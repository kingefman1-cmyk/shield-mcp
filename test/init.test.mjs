// node --test test/init.test.mjs : init and First-Call Fuel never touch the real network or home directory
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mask, mergeConfig, parseArgs, runInit, defaultConfigPath, SERVER_NAME, KEY_ENV } from '../src/init.mjs'
import { credentialsPath, createKeyResolver, installId, readCredentials } from '../src/fuel.mjs'
import { createHandler } from '../src/index.mjs'

const KEY = 'ck_trial_abcdefghijklmnopqrstuvwxyz234567'
const ID = { hostname: 'box-1', username: 'dev', homedir: '/home/dev' }
const harness = (fetchImpl, env = {}, identity = ID) => {
  const home = mkdtempSync(join(tmpdir(), 'init-'))
  const lines = [], errs = []
  return { home, lines, errs, io: { out: (s) => lines.push(s), err: (s) => errs.push(s), env, fetch: fetchImpl, paths: { home }, identity } }
}
const ok = (status, body) => ({ status, ok: status < 400, json: async () => body })
// A stand-in for POST /api/trial-key: first call for an install id mints (201), later calls return the same key (200, reused).
const fakeServer = () => {
  const calls = [], minted = new Map()
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
    if (String(url).includes('trial-key')) {
      const b = JSON.parse(init.body)
      if (b.email) return ok(201, { key: KEY, calls_remaining: 50, expires_at: '2099-01-01T00:00:00.000Z' })
      if (minted.has(b.install_id)) return ok(200, { key: minted.get(b.install_id), calls_remaining: 50, reused: true, expires_at: '2099-01-01T00:00:00.000Z' })
      const k = 'ck_trial_' + 'abcdefghijklmnopqrstuvwxyz234567'.slice(0, 31) + String(minted.size % 8 + 2)
      minted.set(b.install_id, k)
      return ok(201, { key: k, calls_remaining: 50, reused: false, expires_at: '2099-01-01T00:00:00.000Z' })
    }
    return ok(200, { ok: true })
  }
  return { calls, minted, fetchImpl }
}
const posix = process.platform !== 'win32'

test('argument parsing rejects unknown options, a config flag without a path and a bad email', async () => {
  assert.match(parseArgs(['--bogus']).error, /unknown option/)
  assert.match(parseArgs(['--config']).error, /--config needs/)
  assert.deepEqual(parseArgs(['--email=a@b.co', '--dry-run']), { config: null, dryRun: true, verify: true, email: 'a@b.co' })
  const h = harness(fakeServer().fetchImpl)
  assert.equal(await runInit(['--email', 'nope'], h.io), 2)
})

test('the key is masked everywhere it is printed', () => {
  assert.equal(mask(KEY), 'ck_trial_****4567')
  assert.equal(mask('short'), '****')
})

test('installation id: a salted SHA-256 of host, user and home; never the raw values; different user or home, different id', () => {
  const a = installId(ID)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(installId(ID), a, 'stable')
  assert.notEqual(installId({ ...ID, username: 'ci' }), a)
  assert.notEqual(installId({ ...ID, homedir: '/home/other' }), a)
  assert.notEqual(installId({ ...ID, hostname: 'runner-7' }), a)
})

test('first unauthenticated init provisions a trial for this installation, stores it 0600 and keeps it out of the client config', async () => {
  const s = fakeServer()
  const h = harness(s.fetchImpl)
  assert.equal(await runInit([], h.io), 0)
  const trial = s.calls.find((c) => c.url.endsWith('/api/trial-key'))
  assert.deepEqual(Object.keys(trial.body), ['install_id'], 'only the hashed installation id is sent')
  assert.equal(trial.body.install_id, installId(ID))
  assert.ok(!JSON.stringify(trial.body).includes('box-1') && !JSON.stringify(trial.body).includes('/home/dev'))
  const cred = credentialsPath(h.home)
  const saved = JSON.parse(readFileSync(cred, 'utf8'))
  assert.deepEqual(Object.keys(saved).sort(), ['created', 'expires_at', 'key', 'source', 'version'])
  assert.equal(saved.source, 'install'); assert.match(saved.key, /^ck_trial_/)
  if (posix) assert.equal(statSync(cred).mode & 0o777, 0o600, 'credentials are readable by the owner only')
  const cfg = JSON.parse(readFileSync(defaultConfigPath({ home: h.home }), 'utf8'))
  assert.deepEqual(cfg.mcpServers[SERVER_NAME], { command: 'npx', args: ['-y', '@caelaralabs/shield-mcp'] })
  assert.ok(!readFileSync(defaultConfigPath({ home: h.home }), 'utf8').includes('ck_'), 'no key in the client config')
  const printed = h.lines.join('\n') + h.errs.join('\n')
  assert.ok(!printed.includes(saved.key), 'the full key is never printed')
})

test('a second init reuses the saved key with no network call; with the file gone the server returns the same key', async () => {
  const s = fakeServer()
  const h = harness(s.fetchImpl)
  assert.equal(await runInit(['--no-verify'], h.io), 0)
  const first = readCredentials(h.home).key
  const before = s.calls.length
  assert.equal(await runInit(['--no-verify'], h.io), 0)
  assert.equal(s.calls.length, before, 'zero network calls')
  assert.equal(readCredentials(h.home).key, first)
  rmSync(credentialsPath(h.home))
  assert.equal(await runInit(['--no-verify'], h.io), 0)
  assert.equal(readCredentials(h.home).key, first, 'same trial identity, no duplicate')
  assert.equal(s.minted.size, 1)
})

test('--email keeps the email path and also stores the key in the credentials file, not the config', async () => {
  const s = fakeServer()
  const h = harness(s.fetchImpl)
  const target = join(h.home, 'elsewhere', 'servers.json')
  assert.equal(await runInit(['--email', 'dev@example.com', '--config', target, '--no-verify'], h.io), 0)
  assert.equal(readCredentials(h.home).source, 'email')
  assert.ok(!readFileSync(target, 'utf8').includes('ck_'))
  assert.ok(!existsSync(defaultConfigPath({ home: h.home })))
})

test('a key in the environment is used and stored, and nothing is minted', async () => {
  const s = fakeServer()
  const h = harness(s.fetchImpl, { [KEY_ENV]: KEY })
  assert.equal(await runInit(['--no-verify'], h.io), 0)
  assert.equal(s.calls.length, 0)
  assert.equal(readCredentials(h.home).source, 'manual')
})

test('a refused trial (429) writes nothing, explains the refill options and exits 1', async () => {
  const h = harness(async () => ok(429, { error: 'trial_used', message: 'This installation already used its free trial.' }))
  assert.equal(await runInit([], h.io), 1)
  assert.ok(!existsSync(defaultConfigPath({ home: h.home })))
  assert.ok(!existsSync(credentialsPath(h.home)))
  assert.match(h.errs.join(' '), /pay\/personal/)
})

test('dry run writes nothing; an unreadable config is left alone', async () => {
  const h = harness(fakeServer().fetchImpl)
  assert.equal(await runInit(['--dry-run', '--no-verify'], h.io), 0)
  assert.ok(!existsSync(defaultConfigPath({ home: h.home })))
  assert.ok(!existsSync(credentialsPath(h.home)))
  const g = harness(fakeServer().fetchImpl)
  const file = defaultConfigPath({ home: g.home })
  mkdirSync(join(g.home, '.cursor'), { recursive: true })
  writeFileSync(file, '{ not json')
  assert.equal(await runInit(['--no-verify'], g.io), 1)
  assert.equal(readFileSync(file, 'utf8'), '{ not json')
})

test('mergeConfig keeps unrelated servers and replaces its own entry without a key', () => {
  const a = mergeConfig({ mcpServers: { [SERVER_NAME]: { env: { [KEY_ENV]: 'old' } }, z: 1 } })
  assert.equal(a.mcpServers.z, 1)
  assert.deepEqual(a.mcpServers[SERVER_NAME], { command: 'npx', args: ['-y', '@caelaralabs/shield-mcp'] })
})

test('server: the handshake does not provision; the first tool call does, once, and later calls reuse the key', async () => {
  const s = fakeServer()
  const home = mkdtempSync(join(tmpdir(), 'fuel-'))
  const shieldCalls = []
  const fetchImpl = async (url, init) => {
    if (String(url).includes('trial-key')) return s.fetchImpl(url, init)
    shieldCalls.push(init.headers)
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"verdict":"allow"}' }
  }
  const logs = []
  const handle = createHandler({ env: {}, fetch: fetchImpl, baseUrl: 'https://example.test', home, identity: ID, log: (l) => logs.push(l) })
  await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.equal(s.calls.length, 0, 'initialize and tools/list never wait on provisioning')
  for (let i = 0; i < 3; i++) await handle({ jsonrpc: '2.0', id: 3 + i, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: { text: 'hi' } } })
  assert.equal(s.calls.length, 1, 'provisioned once')
  const key = readCredentials(home).key
  assert.ok(shieldCalls.every((h) => h['X-Caelara-Key'] === key))
  assert.ok(!logs.join('\n').includes(key), 'the log line masks the key')
})

test('server: a refused trial keeps the server running and tools answer with x402 terms and refill links', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fuel-'))
  const fetchImpl = async (url) => {
    if (String(url).includes('trial-key')) return ok(429, { error: 'trial_used', message: 'Already used.' })
    return { status: 402, ok: false, headers: { get: () => 'x402' }, text: async () => '{"accepts":[{"network":"base"}]}' }
  }
  const handle = createHandler({ env: {}, fetch: fetchImpl, baseUrl: 'https://example.test', home, identity: ID, log: () => {} })
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: { text: 'hi' } } })
  const body = JSON.parse(r.result.content[0].text)
  assert.equal(r.result.isError, true); assert.equal(body.status, 402)
  assert.equal(body.trial.error, 'trial_used'); assert.match(body.refill.personal, /pay\/personal/)
  assert.ok(!existsSync(credentialsPath(home)))
})

test('server: CAELARA_NO_AUTO_TRIAL=1 never calls the trial service; CAELARA_KEY always wins', async () => {
  const s = fakeServer()
  const home = mkdtempSync(join(tmpdir(), 'fuel-'))
  const r1 = createKeyResolver({ env: { CAELARA_NO_AUTO_TRIAL: '1' }, envName: 'CAELARA_KEY', home, identity: ID, fetch: s.fetchImpl })
  assert.equal(await r1.get(), null)
  const r2 = createKeyResolver({ env: { CAELARA_KEY: KEY }, envName: 'CAELARA_KEY', home, identity: ID, fetch: s.fetchImpl })
  assert.equal(await r2.get(), KEY)
  assert.equal(s.calls.length, 0)
})

test('expired stored credentials are ignored', () => {
  const home = mkdtempSync(join(tmpdir(), 'fuel-'))
  mkdirSync(join(home, '.caelaralabs'), { recursive: true })
  writeFileSync(credentialsPath(home), JSON.stringify({ version: 1, key: KEY, source: 'install', created: '2020-01-01T00:00:00Z', expires_at: '2020-01-08T00:00:00Z' }))
  assert.equal(readCredentials(home), null)
})

test('a dry run never contacts the trial service', async () => {
  const { runInit } = await import('../src/init.mjs').catch(() => ({}))
  if (typeof runInit !== 'function') return
  let calls = 0
  const lines = []
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const home = mkdtempSync(join(tmpdir(), 'dry-'))
  const code = await runInit(['--dry-run', '--no-verify', '--config', join(home, 'c.json')], { fetch: async () => { calls++; return new Response('{}', { status: 500 }) }, env: {}, paths: { home }, out: (l) => lines.push(l), err: (l) => lines.push(l) })
  assert.equal(calls, 0, 'no network call in a dry run')
  assert.equal(code, 0)
  assert.ok(lines.some((l) => /\[dry run\] would request a free trial key/.test(l)))
})
