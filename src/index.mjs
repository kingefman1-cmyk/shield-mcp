// Caelara Shield MCP server: newline-delimited JSON-RPC 2.0 over stdio.
// Stateless. Request and response bodies are never logged or stored.

export const SERVER_INFO = { name: 'caelara-shield', version: '1.0.0' }
export const DEFAULT_BASE_URL = 'https://shield.caelaralabs.com'
export const USER_AGENT = 'CaelaraLabs-Engine/1.0'
export const DEFAULT_TIMEOUT_MS = 3000
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_RESULT_CHARS = 400000

export const TOOLS = [
  {
    name: 'shield_scan_prompt',
    description:
      'Screen untrusted text before it reaches a model: injection patterns, hidden characters, PII and secrets, with an allow/review/block verdict (0.015 USDC per call)',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Untrusted input text (max 200000 characters)' },
        redact: { type: 'boolean', description: 'Return sanitized_text with PII and secrets masked (default true)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'shield_validate_output',
    description:
      'Check model output before it is used: secret and PII leakage, exfiltration links, active content, dangerous shell patterns, optional schema and grounding checks (0.015 USDC per call)',
    inputSchema: {
      type: 'object',
      properties: {
        output: { type: 'string', description: 'Raw model output (max 200000 characters)' },
        schema: { type: 'object', description: 'JSON Schema subset to enforce' },
        source: { type: 'string', description: 'Source text for a grounding check' },
        system_prompt: {
          type: 'string',
          description: 'Your system prompt, used only in this request to detect it being echoed back',
        },
      },
      required: ['output'],
    },
  },
  {
    name: 'shield_proxy_fetch',
    description:
      'Fetch an https URL through an SSRF-guarded proxy and return a JSON envelope with the scanned body (HTTP 200 envelope, upstream status inside) (0.025 USDC per call)',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target https URL' },
        allow: {
          type: 'string',
          description: 'Comma-separated hostnames or *.suffix patterns; when set the target must match',
        },
        include_blocked: {
          type: 'boolean',
          description: 'Return the body even when the content scan verdict is block (default false)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'shield_audit_token',
    description:
      'Screen a token and/or an EVM transaction: token safety score, decoded transaction risks (unlimited approvals, failed or contract-creating transactions), address-poisoning lookalike check (0.050 USDC per call)',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token contract (0x...) or Solana mint to screen' },
        hash: { type: 'string', description: 'EVM transaction hash (0x + 64 hex) to decode and screen' },
        chain: { type: 'string', description: 'base|ethereum|arbitrum|optimism (default base)' },
        destination: { type: 'string', description: 'Address you intend to pay' },
        known_addresses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Addresses you trust, to detect lookalike destinations',
        },
      },
      required: [],
    },
  },
]

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const toolResult = (payload, isError = false) => ({
  content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
  isError,
})

// Build the upstream request for a tool. Returns { method, path, body } or { error }.
export function buildRequest(name, args) {
  const a = isObj(args) ? args : {}
  switch (name) {
    case 'shield_scan_prompt': {
      if (typeof a.text !== 'string') return { error: 'text (string) is required' }
      const body = { text: a.text }
      if (typeof a.redact === 'boolean') body.redact = a.redact
      return { method: 'POST', path: '/v1/shield/prompt', body }
    }
    case 'shield_validate_output': {
      if (typeof a.output !== 'string') return { error: 'output (string) is required' }
      const body = { output: a.output }
      if (isObj(a.schema)) body.schema = a.schema
      if (typeof a.source === 'string') body.source = a.source
      if (typeof a.system_prompt === 'string') body.system_prompt = a.system_prompt
      return { method: 'POST', path: '/v1/shield/output', body }
    }
    case 'shield_proxy_fetch': {
      if (typeof a.url !== 'string' || !/^https:\/\//i.test(a.url)) return { error: 'url (an https URL) is required' }
      const q = new URLSearchParams({ url: a.url })
      if (typeof a.allow === 'string' && a.allow) q.set('allow', a.allow)
      if (a.include_blocked === true) q.set('include_blocked', 'true')
      return { method: 'GET', path: `/v1/proxy/_?${q.toString()}`, body: undefined }
    }
    case 'shield_audit_token': {
      const body = {}
      for (const k of ['token', 'hash', 'chain', 'destination']) if (typeof a[k] === 'string') body[k] = a[k]
      if (Array.isArray(a.known_addresses)) body.known_addresses = a.known_addresses.filter((x) => typeof x === 'string')
      if (!body.token && !body.hash && !body.destination) return { error: 'provide at least one of token, hash or destination' }
      return { method: 'POST', path: '/v1/shield/tx', body }
    }
    default:
      return { error: `unknown tool: ${name}` }
  }
}

export function createHandler(opts = {}) {
  const env = opts.env ?? process.env
  const baseUrl = String(opts.baseUrl ?? env.CAELARA_SHIELD_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = Number(opts.timeoutMs ?? env.CAELARA_SHIELD_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  const fetchImpl = opts.fetch ?? globalThis.fetch

  async function callTool(name, args) {
    const req = buildRequest(name, args)
    if (req.error) return toolResult({ error: 'invalid_arguments', message: req.error }, true)

    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    const key = env.CAELARA_KEY
    if (key) headers['X-Caelara-Key'] = key
    if (req.body !== undefined) headers['Content-Type'] = 'application/json'

    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(baseUrl + req.path, {
        method: req.method,
        headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: ctl.signal,
      })
      let text = await res.text()
      if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS)
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
      if (res.status === 402) {
        return toolResult(
          {
            error: 'payment_required',
            status: 402,
            message: key
              ? 'The key was not accepted. Check CAELARA_KEY or settle via x402 on the REST routes.'
              : 'No CAELARA_KEY set. Set CAELARA_KEY to a Caelara API key, or pay per call via x402 on the REST routes (see https://shield.caelaralabs.com/x402-manifest.json).',
            x_payment_required: res.headers.get('x-payment-required') ?? undefined,
            details: parsed,
          },
          true,
        )
      }
      if (!res.ok) return toolResult({ error: 'upstream_error', status: res.status, details: parsed }, true)
      return toolResult(parsed, false)
    } catch (e) {
      const timedOut = e && e.name === 'AbortError'
      return toolResult(
        timedOut
          ? { error: 'timeout', message: `No response within ${timeoutMs}ms` }
          : { error: 'network_error', message: String((e && e.message) || 'request failed') },
        true,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  // Returns a JSON-RPC response object, or null for notifications.
  return async function handle(msg) {
    if (!isObj(msg) || typeof msg.method !== 'string') {
      if (isObj(msg) && 'id' in msg && msg.id !== null) return { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid Request' } }
      return null
    }
    const hasId = 'id' in msg && msg.id !== null && msg.id !== undefined
    const ok = (result) => (hasId ? { jsonrpc: '2.0', id: msg.id, result } : null)
    const fail = (code, message) => (hasId ? { jsonrpc: '2.0', id: msg.id, error: { code, message } } : null)

    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params && msg.params.protocolVersion
        return ok({
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: TOOLS })
      case 'tools/call': {
        const p = msg.params
        if (!isObj(p) || typeof p.name !== 'string') return fail(-32602, 'Invalid params: name is required')
        if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, `Unknown tool: ${p.name}`)
        return ok(await callTool(p.name, p.arguments))
      }
      default:
        if (msg.method.startsWith('notifications/')) return null
        return fail(-32601, `Method not found: ${msg.method}`)
    }
  }
}

export function runStdio(opts = {}) {
  const input = opts.input ?? process.stdin
  const output = opts.output ?? process.stdout
  const handle = createHandler(opts)
  let buf = ''
  const send = (obj) => output.write(JSON.stringify(obj) + '\n')

  async function onLine(line) {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    try {
      const res = await handle(msg)
      if (res) send(res)
    } catch {
      if (isObj(msg) && msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'Internal error' } })
    }
  }

  input.setEncoding('utf8')
  input.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      void onLine(line)
    }
  })
  input.on('end', () => {
    if (buf.trim()) void onLine(buf)
  })
}
