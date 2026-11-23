import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHandler, TOOLS } from '../src/index.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Every test runs against a throwaway home directory and never provisions a real trial unless it says so.
const tmpHome = () => mkdtempSync(join(tmpdir(), 'shield-home-'))

const BIN = fileURLToPath(new URL('../bin/shield-mcp.mjs', import.meta.url))

let server
let base
const seen = []

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body })
      if (req.url === '/api/trial-key') {
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ key: 'ck_trial_stdiostdiostdiostdiostdio2345', calls_remaining: 50, reused: false, expires_at: '2099-01-01T00:00:00.000Z' }))
        return
      }
      if (req.url.startsWith('/v1/shield/output')) {
        // never answers within the timeout
        setTimeout(() => res.end('{}'), 5000).unref()
        return
      }
      if (!req.headers['x-caelara-key']) {
        res.writeHead(402, { 'content-type': 'application/json', 'x-payment-required': 'x402;amount=0.015;asset=USDC' })
        res.end(JSON.stringify({ error: 'payment required', accepts: [{ scheme: 'exact', network: 'base' }] }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ verdict: 'allow', path: req.url }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.closeAllConnections?.()
  server.close()
})

// Spawn the stdio server, send requests, collect responses by id.
async function session(env, requests) {
  const child = spawn(process.execPath, [BIN], {
    env: (() => { const h = tmpHome(); return { PATH: process.env.PATH, HOME: h, USERPROFILE: h, CAELARA_NO_AUTO_TRIAL: '1', CAELARA_SHIELD_URL: base, CAELARA_SHIELD_TIMEOUT_MS: '400', ...env } })(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => (out += d))
  const want = requests.filter((r) => r.id !== undefined).length
  for (const r of requests) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...r }) + '\n')
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (out.split('\n').filter(Boolean).length >= want) break
    await new Promise((r) => setTimeout(r, 25))
  }
  child.kill()
  const byId = {}
  for (const l of out.split('\n').filter(Boolean)) {
    const m = JSON.parse(l)
    byId[m.id] = m
  }
  return byId
}

test('initialize, notification and tools/list', async () => {
  const r = await session({}, [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'nope' },
  ])
  assert.equal(r[1].result.protocolVersion, '2025-06-18')
  assert.ok(r[1].result.capabilities.tools)
  assert.equal(r[1].result.serverInfo.name, 'caelara-shield')
  assert.deepEqual(
    r[2].result.tools.map((t) => t.name),
    ['shield_preflight', 'shield_scan_prompt', 'shield_validate_output', 'shield_proxy_fetch', 'shield_audit_token'],
  )
  assert.equal(r[3].error.code, -32601)
})

test('tools/call success sends key, UA and body', async () => {
  seen.length = 0
  const r = await session({ CAELARA_KEY: 'test-key-123' }, [
    { id: 1, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: { text: 'hello', redact: false } } },
    { id: 2, method: 'tools/call', params: { name: 'shield_proxy_fetch', arguments: { url: 'https://example.com/x', allow: 'example.com' } } },
    { id: 3, method: 'tools/call', params: { name: 'shield_audit_token', arguments: { token: '0xabc', known_addresses: ['0x1'] } } },
  ])
  for (const id of [1, 2, 3]) {
    assert.equal(r[id].result.isError, false)
    assert.equal(JSON.parse(r[id].result.content[0].text).verdict, 'allow')
  }
  const post = seen.find((s) => s.url === '/v1/shield/prompt')
  assert.equal(post.method, 'POST')
  assert.equal(post.headers['x-caelara-key'], 'test-key-123')
  assert.equal(post.headers['user-agent'], 'CaelaraLabs-Engine/1.0')
  assert.deepEqual(JSON.parse(post.body), { text: 'hello', redact: false })
  const get = seen.find((s) => s.url.startsWith('/v1/proxy/'))
  assert.equal(get.method, 'GET')
  assert.equal(new URL(get.url, base).searchParams.get('url'), 'https://example.com/x')
  assert.equal(new URL(get.url, base).searchParams.get('allow'), 'example.com')
  assert.ok(seen.find((s) => s.url === '/v1/shield/tx'))
})

test('tools/call without a key surfaces the 402 payment info', async () => {
  const r = await session({}, [{ id: 1, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: { text: 'hi' } } }])
  assert.equal(r[1].error, undefined)
  assert.equal(r[1].result.isError, true)
  const p = JSON.parse(r[1].result.content[0].text)
  assert.equal(p.error, 'payment_required')
  assert.equal(p.status, 402)
  assert.match(p.x_payment_required, /x402/)
  assert.equal(p.details.accepts[0].network, 'base')
  assert.match(p.message, /CAELARA_KEY/)
})

test('timeout returns a graceful error result', async () => {
  const r = await session({ CAELARA_KEY: 'k' }, [
    { id: 1, method: 'tools/call', params: { name: 'shield_validate_output', arguments: { output: 'x' } } },
  ])
  assert.equal(r[1].error, undefined)
  assert.equal(r[1].result.isError, true)
  assert.equal(JSON.parse(r[1].result.content[0].text).error, 'timeout')
})

test('invalid arguments and unknown tool do not throw', async () => {
  const r = await session({ CAELARA_KEY: 'k' }, [
    { id: 1, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: {} } },
    { id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
  ])
  assert.equal(r[1].result.isError, true)
  assert.equal(JSON.parse(r[1].result.content[0].text).error, 'invalid_arguments')
  assert.equal(r[2].error.code, -32602)
})

test('unreachable host returns network_error result', async () => {
  const r = await session({ CAELARA_KEY: 'k', CAELARA_SHIELD_URL: 'http://127.0.0.1:1' }, [
    { id: 1, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: { text: 'a' } } },
  ])
  assert.equal(r[1].result.isError, true)
  assert.equal(JSON.parse(r[1].result.content[0].text).error, 'network_error')
})

// ---- screening tools against a mock fetch; the router tools are retired ----
function mockHandler(respond, env = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const r = respond(url, init)
    return {
      status: r.status ?? 200,
      ok: (r.status ?? 200) < 400,
      headers: { get: () => null },
      text: async () => JSON.stringify(r.body),
    }
  }
  return { handle: createHandler({ env: { CAELARA_NO_AUTO_TRIAL: '1', ...env }, fetch, baseUrl: 'https://example.test', home: tmpHome(), log: () => {} }), calls }
}

const call = (handle, name, args) =>
  handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.result)

test('tools/list exposes the five screening tools, preflight first', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['shield_preflight', 'shield_scan_prompt', 'shield_validate_output', 'shield_proxy_fetch', 'shield_audit_token'])
  for (const t of TOOLS) assert.doesNotMatch(t.description, /swap|unsigned|route/i)
})

test('retired router and builder tools are unknown and never reach the network', async () => {
  const { handle, calls } = mockHandler(() => ({ body: { ok: true } }))
  for (const name of ['shield_route_quote', 'shield_safe_swap', 'shield_universal_action']) {
    const r = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: {} } })
    assert.equal(r.error.code, -32602)
    assert.match(r.error.message, /Unknown tool/)
  }
  assert.equal(calls.length, 0)
})

test('shield_audit_token posts token, chain and known addresses to /v1/shield/tx with the key', async () => {
  const { handle, calls } = mockHandler(() => ({ body: { verdict: 'allow', findings: [] } }), { CAELARA_KEY: 'k' })
  const res = await call(handle, 'shield_audit_token', { token: 'Mint1111111111111111111111111111111111pump', chain: 'solana', known_addresses: ['a', 1] })
  assert.equal(res.isError, false)
  assert.equal(calls[0].url, 'https://example.test/v1/shield/tx')
  assert.deepEqual(JSON.parse(calls[0].init.body), { token: 'Mint1111111111111111111111111111111111pump', chain: 'solana', known_addresses: ['a'] })
  assert.equal(calls[0].init.headers['X-Caelara-Key'], 'k')
  assert.equal(JSON.parse(res.content[0].text).verdict, 'allow')
})

test('preflight is opt-in: no clearance is sent until the agent runs shield_preflight, then later calls carry it', async () => {
  const CLR = 'a'.repeat(64)
  const { handle, calls } = mockHandler((url) => (url.endsWith('/v1/shield/preflight') ? { body: { verdict: 'allow', clearance_id: CLR } } : { body: { verdict: 'allow' } }), { CAELARA_KEY: 'ck_live_x' })
  await call(handle, 'shield_scan_prompt', { text: 'hello' })
  assert.equal(calls[0].init.headers['X-Caelara-Clearance'], undefined, 'nothing extra is sent by default')
  const r = await call(handle, 'shield_preflight', { system_prompt: 'You summarise invoices.', tools: ['read_invoice'] })
  assert.equal(r.isError, false)
  assert.equal(calls[1].url, 'https://example.test/v1/shield/preflight')
  assert.deepEqual(JSON.parse(calls[1].init.body), { system_prompt: 'You summarise invoices.', tools: ['read_invoice'] })
  await call(handle, 'shield_scan_prompt', { text: 'hello' })
  assert.equal(calls[2].init.headers['X-Caelara-Clearance'], CLR)
  const bad = await call(handle, 'shield_preflight', {})
  assert.equal(bad.isError, true)
  const preset = mockHandler(() => ({ body: { verdict: 'allow' } }), { CAELARA_KEY: 'ck_live_x', CAELARA_CLEARANCE: CLR.toUpperCase() })
  await call(preset.handle, 'shield_validate_output', { output: 'x' })
  assert.equal(preset.calls[0].init.headers['X-Caelara-Clearance'], CLR)
})

test('stdio First-Call Fuel: first tool call provisions from the trial service, uses the key, and never prints it', async () => {
  const h = tmpHome()
  const child = spawn(process.execPath, [BIN], {
    env: { PATH: process.env.PATH, HOME: h, USERPROFILE: h, CAELARA_SHIELD_URL: base, CAELARA_TRIAL_URL: base + '/api/trial-key', CAELARA_SHIELD_TIMEOUT_MS: '2000' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = '', errOut = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (errOut += d))
  const before = seen.length
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shield_scan_prompt', arguments: { text: 'hello' } } }) + '\n')
  const deadline = Date.now() + 8000
  while (Date.now() < deadline && !out.includes('"id":1')) await new Promise((r) => setTimeout(r, 25))
  child.kill()
  const reply = JSON.parse(out.split('\n').find(Boolean))
  assert.equal(reply.result.isError, false)
  const shieldCall = seen.slice(before).find((s) => s.url.startsWith('/v1/shield/prompt'))
  assert.equal(shieldCall.headers['x-caelara-key'], 'ck_trial_stdiostdiostdiostdiostdio2345')
  assert.ok(!(out + errOut).includes('ck_trial_stdiostdiostdiostdiostdio2345'), 'the key never reaches stdout or stderr')
  assert.match(errOut, /ck_trial_\*\*\*\*2345/)
})
