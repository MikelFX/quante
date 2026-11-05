'use client'

// /qbox public docs (2026-11-05, owner: Qbox is the place for every agent on the internet, paid only,
// agents pay by themselves). Visible signed out too: how an agent connects (MCP, REST, x402
// self-signup), the price list and limits — all numbers from lib/qbox/model.ts, never typed here.

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { QBOX_BETA, QBOX_PAID, QBOX_PAID_VCPUS, QBOX_PRICING, QBOX_TEMPLATES } from '@/lib/qbox/limits'

const API = 'https://quantecode.com/api/qbox/v1'
const MCP = `${API}/mcp`

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="qb-copy"
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }) }}
    >
      {done ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {done ? 'Copied' : label}
    </button>
  )
}

export function snippets(key: string) {
  const k = key || 'qbx_…'
  return {
    curl: [
      `# Start a sandbox, run a command, stop it`,
      `ID=$(curl -s -X POST ${API}/sandboxes \\`,
      `  -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" \\`,
      `  -d '{"template":"node24","timeoutMs":300000}' | jq -r .id)`,
      ``,
      `curl -s -X POST ${API}/sandboxes/$ID/exec \\`,
      `  -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" \\`,
      `  -d '{"command":"node -v && echo hello > out.txt"}'`,
      ``,
      `curl -s "${API}/sandboxes/$ID/files?path=out.txt" -H "Authorization: Bearer ${k}"`,
      `curl -s -X DELETE ${API}/sandboxes/$ID -H "Authorization: Bearer ${k}"`,
    ].join('\n'),
    python: [
      `import requests`,
      ``,
      `API = "${API}"`,
      `H = {"Authorization": "Bearer ${k}"}`,
      ``,
      `box = requests.post(f"{API}/sandboxes", json={"template": "python3.13", "timeoutMs": 300_000}, headers=H).json()`,
      `try:`,
      `    r = requests.post(f"{API}/sandboxes/{box['id']}/exec",`,
      `                      json={"command": "python -c 'print(2 ** 100)'"}, headers=H).json()`,
      `    print(r["stdout"])`,
      `finally:`,
      `    requests.delete(f"{API}/sandboxes/{box['id']}", headers=H)  # unused time returns`,
    ].join('\n'),
    node: [
      `const API = '${API}'`,
      `const H = { Authorization: 'Bearer ${k}', 'Content-Type': 'application/json' }`,
      `const call = (path, init = {}) => fetch(API + path, { ...init, headers: H }).then((r) => r.json())`,
      ``,
      `const box = await call('/sandboxes', { method: 'POST', body: JSON.stringify({ template: 'node24' }) })`,
      `try {`,
      `  const r = await call(\`/sandboxes/\${box.id}/exec\`, { method: 'POST', body: JSON.stringify({ command: 'npm -v' }) })`,
      `  console.log(r.stdout)`,
      `} finally {`,
      `  await call(\`/sandboxes/\${box.id}\`, { method: 'DELETE' })`,
      `}`,
    ].join('\n'),
    mcp: JSON.stringify({ mcpServers: { qbox: { type: 'http', url: MCP, headers: { Authorization: `Bearer ${k}` } } } }, null, 2),
    claude: `claude mcp add --transport http qbox ${MCP} --header "Authorization: Bearer ${k}"`,
    openai: [
      `from agents import Agent, Runner`,
      `from agents.mcp import MCPServerStreamableHttp`,
      ``,
      `async with MCPServerStreamableHttp(params={"url": "${MCP}",`,
      `        "headers": {"Authorization": "Bearer ${k}"}}) as qbox:`,
      `    agent = Agent(name="coder", instructions="Run code in Qbox.", mcp_servers=[qbox])`,
      `    print((await Runner.run(agent, "Compute the 30th Fibonacci number in Python")).final_output)`,
    ].join('\n'),
    langchain: [
      `from langchain_mcp_adapters.client import MultiServerMCPClient`,
      ``,
      `client = MultiServerMCPClient({"qbox": {"transport": "streamable_http", "url": "${MCP}",`,
      `                               "headers": {"Authorization": "Bearer ${k}"}}})`,
      `tools = await client.get_tools()  # create_sandbox, run_command, write_file, …`,
    ].join('\n'),
    x402: [
      `// An agent with a USDC wallet opens its own account: no sign-up, no human.`,
      `import { wrapFetchWithPayment } from 'x402-fetch'`,
      `import { privateKeyToAccount } from 'viem/accounts'`,
      ``,
      `const pay = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.AGENT_WALLET_KEY))`,
      `const res = await pay('${API}/accounts?usd=5', { method: 'POST' })  // 402 → pays → 201`,
      `const { apiKey, balanceVcpuMinutes } = await res.json()`,
      `// Later, any call that answers 402 (balance low) is paid and repeated the same way.`,
    ].join('\n'),
  }
}

const TABS = [
  ['mcp', 'MCP (Cursor, Claude Desktop…)'],
  ['claude', 'Claude Code'],
  ['openai', 'OpenAI Agents'],
  ['langchain', 'LangChain'],
  ['curl', 'curl'],
  ['python', 'Python'],
  ['node', 'Node'],
  ['x402', 'Agent pays itself (x402)'],
] as const

export function CodeTabs({ apiKey }: { apiKey: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('mcp')
  const code = snippets(apiKey)[tab]
  return (
    <div className="qb-card">
      <div className="qb-h"><h2>Connect your agent</h2><CopyBtn text={code} /></div>
      <div className="qb-tabs" role="tablist" aria-label="Integration">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="qb-tab" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <pre className="qb-code" role="tabpanel">{code}</pre>
      <p className="qb-muted">
        Machine-readable: <a href="/qbox/llms.txt">llms.txt</a> · <a href="/api/qbox/v1/openapi.json">OpenAPI</a> · MCP <code>{MCP}</code>
      </p>
    </div>
  )
}

const usd = (vcpuMinutes: number) => `$${(vcpuMinutes / QBOX_PRICING.vcpuMinutesPerUsd).toFixed(2)}`

export function Pricing() {
  return (
    <div className="qb-card">
      <h2>Price</h2>
      <p className="qb-muted">Paid only, per use. You pay for the time a sandbox lives × its vCPUs (2 GB memory per vCPU included), plus a tiny fee per command or file operation. Unused reserved time returns when you stop a sandbox.</p>
      <div className="qb-price">
        <div><b>{usd(120)}</b><span>2 vCPU sandbox, 1 hour</span></div>
        <div><b>{usd(10)}</b><span>1 vCPU sandbox, 10 minutes</span></div>
        <div><b>{usd(QBOX_PRICING.opVcpuMinutes * 1000)}</b><span>1,000 commands or file operations</span></div>
      </div>
      <ul className="qb-list">
        <li>$1 = {QBOX_PRICING.vcpuMinutesPerUsd} vCPU-minutes · 1 Quante credit = {QBOX_PRICING.vcpuMinutesPerCredit} vCPU-minutes · at least {QBOX_PRICING.minBilledMinutes} minute per sandbox.</li>
        <li>Agents pay by themselves in USDC over x402 (from ${QBOX_PRICING.minUsd}); people top up with Quante credits.</li>
        <li>Templates {QBOX_TEMPLATES.join(', ')} · {QBOX_PAID_VCPUS.join(' / ')} vCPUs · up to {QBOX_PAID.maxConcurrent} at once · {QBOX_PAID.maxTimeoutMs / 60_000} min each · files {QBOX_BETA.maxFileBytes / 1024 / 1024} MB · {QBOX_PAID.maxPorts} preview ports.</li>
      </ul>
    </div>
  )
}
