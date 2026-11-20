import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHandler, TOOLS } from '../src/index.mjs'

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
    env: { PATH: process.env.PATH, CAELARA_SHIELD_URL: base, CAELARA_SHIELD_TIMEOUT_MS: '400', ...env },
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
    ['shield_scan_prompt', 'shield_validate_output', 'shield_proxy_fetch', 'shield_audit_token', 'shield_route_quote', 'shield_safe_swap'],
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

// ---- router tools, against a mock fetch ----
const ROUTE_ARGS = { fromChain: 'base', tokenIn: 'native', tokenOut: '0xabc', amount: '10000000' }

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
  return { handle: createHandler({ env, fetch, baseUrl: 'https://example.test' }), calls }
}

const call = (handle, name, args) =>
  handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.result)

test('tools/list exposes six tools', () => {
  assert.equal(TOOLS.length, 6)
})

test('shield_route_quote builds the right request without a key', async () => {
  const { handle, calls } = mockHandler(() => ({ body: { ok: true, provider: 'velora', kind: 'swap', extra: 'dropped', fee: { bps: 50 } } }))
  const res = await call(handle, 'shield_route_quote', { ...ROUTE_ARGS, slippageBps: 100, overrideRisk: false })
  assert.equal(res.isError, false)
  assert.equal(calls[0].url, 'https://example.test/v1/route/quote')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { ...ROUTE_ARGS, slippageBps: 100, overrideRisk: false })
  assert.equal(calls[0].init.headers['X-Caelara-Key'], undefined)
  const out = JSON.parse(res.content[0].text)
  assert.equal(out.provider, 'velora')
  assert.equal(out.extra, undefined)
  assert.equal(out.transactions, undefined)
})

test('shield_safe_swap posts to build, keeps transactions, key header only if set', async () => {
  const body = { ok: true, provider: 'velora', transactions: [{ type: 'swap', chainId: 8453, to: '0x1', data: '0x', value: '0' }], execution: 'Unsigned.' }
  const a = mockHandler(() => ({ body }))
  const res = await call(a.handle, 'shield_safe_swap', { ...ROUTE_ARGS, taker: '0xtaker' })
  assert.equal(a.calls[0].url, 'https://example.test/v1/route/build')
  assert.equal(JSON.parse(a.calls[0].init.body).taker, '0xtaker')
  assert.equal(a.calls[0].init.headers['X-Caelara-Key'], undefined)
  assert.equal(JSON.parse(res.content[0].text).transactions.length, 1)
  const b = mockHandler(() => ({ body }), { CAELARA_KEY: 'k' })
  await call(b.handle, 'shield_safe_swap', { ...ROUTE_ARGS, taker: '0xtaker' })
  assert.equal(b.calls[0].init.headers['X-Caelara-Key'], 'k')
})

test('route API errors pass through code and message', async () => {
  const { handle } = mockHandler(() => ({ status: 422, body: { ok: false, error: 'blocked_by_screening', message: 'token flagged' } }))
  const res = await call(handle, 'shield_safe_swap', { ...ROUTE_ARGS, taker: '0xt' })
  assert.equal(res.isError, true)
  const p = JSON.parse(res.content[0].text)
  assert.equal(p.error, 'blocked_by_screening')
  assert.equal(p.message, 'token flagged')
})

test('route tools validate input without calling upstream', async () => {
  const { handle, calls } = mockHandler(() => ({ body: { ok: true } }))
  const bad = [
    ['shield_route_quote', { ...ROUTE_ARGS, fromChain: 'dogechain' }],
    ['shield_route_quote', { ...ROUTE_ARGS, toChain: 'nope' }],
    ['shield_safe_swap', ROUTE_ARGS],
    ['shield_route_quote', { ...ROUTE_ARGS, amount: '1.5' }],
    ['shield_route_quote', { ...ROUTE_ARGS, amount: 100 }],
    ['shield_route_quote', { ...ROUTE_ARGS, slippageBps: 900 }],
  ]
  for (const [name, args] of bad) {
    const res = await call(handle, name, args)
    assert.equal(res.isError, true, JSON.stringify(args))
    assert.equal(JSON.parse(res.content[0].text).error, 'invalid_arguments')
  }
  assert.equal(calls.length, 0)
})

test('no tool schema has a key, seed or signer field', () => {
  const names = []
  const walk = (o) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'properties') names.push(...Object.keys(v)); walk(v) }
  }
  for (const t of TOOLS) walk(t.inputSchema)
  assert.ok(names.length > 10)
  for (const n of names) assert.doesNotMatch(n, /key|seed|mnemonic|private|signer/i, n)
})
