#!/usr/bin/env node
// shield-mcp            starts the stdio MCP server
// shield-mcp init ...   one-step quickstart: free trial key, MCP client config, connectivity check
if (process.argv[2] === 'init') {
  const { runInit } = await import('../src/init.mjs')
  process.exitCode = await runInit(process.argv.slice(3))
} else {
  const { runStdio } = await import('../src/index.mjs')
  runStdio()
}
