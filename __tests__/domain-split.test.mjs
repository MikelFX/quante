// The domain split (lib/domains.ts, docs/domain-cutover.md): the AssetraDigital website on
// assetradigital.agency, the Quante app on quantecode.com, one deployment. next.config.ts redirects
// each host's foreign paths, so every route must belong to exactly one side — a new page that is on
// neither list would be served on the wrong host. And Clerk must never reach the website.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { SITE_PATHS, APP_PATHS, QUANTE_PATHS, hostKind, isSitePath, isQuantePath, isClerkFreePage, siteHref, appHref, quanteHref } = await import('../lib/domains.ts')

/** First URL segment a Next path pattern covers ('' for '/'). */
const first = (p) => p.split('/')[1].replace(/:.*$/, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Every page / route handler under app/: its URL's first segment and whether it is in app/(site). */
function routes() {
  const app = join(ROOT, 'app')
  return walk(app)
    .filter((f) => /[\\/](page\.tsx|route\.tsx?)$/.test(f))
    .map((f) => {
      const parts = relative(app, f).split(sep).slice(0, -1)
      const url = parts.filter((s) => !/^\(.*\)$/.test(s))
      return { file: relative(ROOT, f), seg: url[0] ?? '', site: parts[0] === '(site)' }
    })
    .filter((r) => r.seg !== 'api')
}

test('every route belongs to exactly one host', () => {
  const site = new Set(SITE_PATHS.map(first))
  const app = new Set(APP_PATHS.map(first))
  const quante = new Set(QUANTE_PATHS.map(first))
  for (const s of site) assert.ok(!app.has(s) && !quante.has(s), `/${s} is on two lists`)
  for (const q of quante) assert.ok(!app.has(q), `/${q} is on two lists`)
  for (const r of routes()) {
    if (r.site) assert.ok(site.has(r.seg) || quante.has(r.seg), `${r.file}: /${r.seg} is a website page — add it to SITE_PATHS (or QUANTE_PATHS)`)
    else assert.ok(app.has(r.seg), `${r.file}: /${r.seg} is an app page — add it to APP_PATHS`)
  }
  // the Quante product pages are rendered by app/(site)/(quante)
  for (const r of routes().filter((r) => quante.has(r.seg))) assert.match(r.file, /app[\\/]\(site\)[\\/]\(quante\)/, r.file)
})

test('quantecode.com is the Quante products: its root is the overview, assetradigital.agency sends them across', async () => {
  const cfg = readFileSync(join(ROOT, 'next.config.ts'), 'utf8')
  assert.match(cfg, /beforeFiles: \[\{ source: '\/', has: \[\{ type: 'host', value: APP_HOST_PATTERN \}\], destination: '\/quante' \}\]/)
  assert.match(cfg, /source: '\/quante', has: \[\{ type: 'host', value: SITE_HOST_PATTERN \}\], destination: APP_ORIGIN \+ '\/'/)
  assert.match(cfg, /source: '\/quante\/:path\+', has: \[\{ type: 'host', value: SITE_HOST_PATTERN \}\], destination: APP_ORIGIN \+ '\/quante\/:path\+'/)
  assert.match(cfg, /source: '\/quante', has: \[\{ type: 'host', value: APP_HOST_PATTERN \}\], destination: '\/'/)
  // the app host's root is no longer sent to the wizard / dashboard
  assert.doesNotMatch(readFileSync(join(ROOT, 'proxy.ts'), 'utf8'), /isAppRoot|'\/start'/)
})

test('hosts are told apart, previews and localhost serve both', () => {
  assert.equal(hostKind('assetradigital.agency'), 'site')
  assert.equal(hostKind('www.assetradigital.agency'), 'site')
  assert.equal(hostKind('quantecode.com'), 'app')
  assert.equal(hostKind('QuanteCode.com:443'), 'app')
  assert.equal(hostKind('shop.stores.quantecode.com'), 'shared')
  assert.equal(hostKind('quante-git-assetradigital-mikelfxs-projects.vercel.app'), 'shared')
  assert.equal(hostKind('localhost:3000'), 'shared')
  assert.equal(hostKind('assetradigital.agency.evil.com'), 'shared')
})

test('website and Quante pages skip Clerk in the proxy, nothing else does', () => {
  for (const p of ['/', '/obchodni-podminky', '/design', '/og']) assert.ok(isSitePath(p) && isClerkFreePage(p), p)
  for (const p of ['/quante', '/quante/', '/quante/qads', '/quante/qgent']) assert.ok(isQuantePath(p) && !isSitePath(p) && isClerkFreePage(p), p)
  for (const p of ['/quantex', '/qads', '/qgent', '/login', '/dashboard', '/api/leads', '/api/qgent/public', '/terms', '/preview/x']) assert.ok(!isClerkFreePage(p), p)
  assert.match(readFileSync(join(ROOT, 'proxy.ts'), 'utf8'), /if \(isClerkFreePage\(req\.nextUrl\.pathname\)\) return NextResponse\.next\(\)/)
})

test('outside production builds the cross-host links stay relative', () => {
  assert.equal(siteHref('/quante#cenik'), '/quante#cenik')
  assert.equal(appHref('/dashboard'), '/dashboard')
  assert.equal(quanteHref('/quante#cenik'), '/quante#cenik')
  assert.equal(quanteHref('/quante/qgent'), '/quante/qgent')
})

test('in production the Quante links point at quantecode.com, its overview at the root', async () => {
  const prev = process.env.NEXT_PUBLIC_VERCEL_ENV
  process.env.NEXT_PUBLIC_VERCEL_ENV = 'production'
  try {
    const d = await import('../lib/domains.ts?prod')
    assert.equal(d.quanteHref('/quante'), 'https://quantecode.com/')
    assert.equal(d.quanteHref('/quante#cenik'), 'https://quantecode.com/#cenik')
    assert.equal(d.quanteHref('/quante/qgent'), 'https://quantecode.com/quante/qgent')
    assert.equal(d.quanteHref('/quantex'), 'https://quantecode.com/quantex')
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_VERCEL_ENV
    else process.env.NEXT_PUBLIC_VERCEL_ENV = prev
  }
})

// Clerk only in the Quante app: these layouts wrap their tree in <QuanteClerk>.
const CLERK_ROOTS = ['app/(app)', 'app/(marketing)', 'app/login', 'app/signup', 'app/qads', 'app/qscan', 'app/qgent', 'app/qbox', 'app/agent-shops']
// Shared components that use Clerk on the client, and where they may be used.
const CLERK_COMPONENTS = { 'components/public/PublicNav.tsx': 'PublicNav' }

const norm = (f) => relative(ROOT, f).split(sep).join('/')
const clientClerk = (src) => /from ['"]@clerk\/nextjs['"]/.test(src)

test('the root layout and the website do not load Clerk', () => {
  const root = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8')
  assert.ok(!/@clerk/.test(root), 'app/layout.tsx imports Clerk')
  for (const f of walk(join(ROOT, 'app', '(site)'))) {
    assert.ok(!/@clerk|QuanteClerk|PublicNav/.test(readFileSync(f, 'utf8')), `${norm(f)} uses Clerk`)
  }
})

test('every client use of Clerk sits under a layout that provides it', () => {
  for (const r of CLERK_ROOTS) {
    const layout = readFileSync(join(ROOT, r, 'layout.tsx'), 'utf8')
    assert.ok(/<QuanteClerk>/.test(layout), `${r}/layout.tsx does not wrap its tree in <QuanteClerk>`)
  }
  const inRoot = (f) => CLERK_ROOTS.some((r) => f.startsWith(r + '/'))
  const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))].filter((f) => /\.tsx?$/.test(f)).map((f) => [norm(f), readFileSync(f, 'utf8')])
  for (const [f, src] of files) {
    if (f.startsWith('app/api/') || f === 'components/auth/QuanteClerk.tsx') continue
    if (clientClerk(src)) assert.ok(inRoot(f) || f in CLERK_COMPONENTS, `${f} uses @clerk/nextjs outside the Clerk layouts`)
    for (const [comp, name] of Object.entries(CLERK_COMPONENTS)) {
      if (f !== comp && new RegExp(`\\b${name}\\b`).test(src) && /^import /m.test(src) && src.includes(comp.replace(/\.tsx$/, '').replace(/^components/, '@/components'))) {
        assert.ok(inRoot(f), `${f} renders ${name} (Clerk) outside the Clerk layouts`)
      }
    }
  }
})
