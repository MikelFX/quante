// Diagnostika changelog vrstev.
//
// Spuštění (z rootu projektu):
//   npx tsx scripts/check-changelog.ts
//
// Ověřuje po pořadě:
//   1. env — jestli jsou v .env.local NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      ADMIN_EMAILS a jestli klíč skutečně vypadá jako service_role JWT.
//   2. tabulka — select count(*) na changelog_entries se service-role klíčem.
//   3. anon vs service — udělá stejný select s anon key. RLS je zapnutá bez policy,
//      takže anon musí vracet 0 řádků (nebo error). Pokud vrací normálně, je to varovný signál.
//   4. ISR — připomene, že /changelog má revalidate=300 (0 automatické invalidace).
//
// Nemodifikuje žádná data.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// -------- načtení .env.local (bez závislosti na dotenv) --------

function loadEnv(path: string): Record<string, string> {
  try {
    const raw = readFileSync(path, 'utf8')
    const out: Record<string, string> = {}
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

const envFromFile = loadEnv(resolve(process.cwd(), '.env.local'))
const env = { ...envFromFile, ...process.env } as Record<string, string | undefined>

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'

function ok(msg: string) { console.log(`${GREEN}[ok]${RESET}   ${msg}`) }
function warn(msg: string) { console.log(`${YELLOW}[warn]${RESET} ${msg}`) }
function bad(msg: string) { console.log(`${RED}[bad]${RESET}  ${msg}`) }
function info(msg: string) { console.log(`${CYAN}[info]${RESET} ${msg}`) }

async function main() {

// -------- 1) env --------

console.log('\n=== 1) environment ===')

const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const adminEmails = env.ADMIN_EMAILS

if (!url) bad('NEXT_PUBLIC_SUPABASE_URL is MISSING (.env.local)')
else ok(`NEXT_PUBLIC_SUPABASE_URL = ${url}`)

if (!serviceKey || serviceKey === 'placeholder') {
  bad('SUPABASE_SERVICE_ROLE_KEY is MISSING or placeholder — server will silently return 0 rows from anon perspective')
} else {
  // heuristika: JWT se skládá ze 3 částí oddělených tečkou; middle část obsahuje "role":"service_role"
  const parts = serviceKey.split('.')
  if (parts.length !== 3) {
    warn(`SUPABASE_SERVICE_ROLE_KEY nemá tvar JWT (3 části), má ${parts.length}`)
  } else {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      if (payload.role === 'service_role') ok('SUPABASE_SERVICE_ROLE_KEY has role=service_role')
      else bad(`SUPABASE_SERVICE_ROLE_KEY has role=${payload.role} — should be service_role`)
    } catch {
      warn('SUPABASE_SERVICE_ROLE_KEY payload could not be decoded')
    }
  }
}

if (!adminEmails || adminEmails.trim() === '') {
  bad('ADMIN_EMAILS is EMPTY — /admin will redirect to /dashboard, API returns 403')
} else {
  const list = adminEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  ok(`ADMIN_EMAILS (${list.length}): ${list.join(', ')}`)
}

// -------- 2) tabulka (service role) --------

console.log('\n=== 2) table check (service role) ===')

if (!url || !serviceKey || serviceKey === 'placeholder') {
  bad('skipping — env incomplete')
} else {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error, count } = await admin
    .from('changelog_entries')
    .select('id, date, title, tags', { count: 'exact' })
    .order('date', { ascending: false })
    .limit(3)

  if (error) {
    bad(`select failed: ${error.code ?? '?'} — ${error.message}`)
    if (error.message.includes('does not exist') || error.code === '42P01') {
      info('=> tabulka changelog_entries neexistuje. Spusť supabase/migration-changelog.sql v Supabase SQL editoru.')
    }
  } else {
    ok(`table exists, row count = ${count ?? '?'}`)
    if ((count ?? 0) === 0) {
      warn('tabulka je prázdná — seed z migrace neproběhl, nebo byly řádky smazány')
    } else {
      info(`ukázka nejnovějších záznamů:`)
      for (const row of data ?? []) {
        console.log(`   ${row.date}  "${row.title}"  [${(row.tags ?? []).join(',')}]`)
      }
    }
  }
}

// -------- 3) anon perspektiva (RLS bez policy → 0 rows) --------

console.log('\n=== 3) anon check (should return 0 rows because RLS has no policy) ===')

if (!url || !anonKey) {
  warn('skipping — NEXT_PUBLIC_SUPABASE_ANON_KEY not set (only relevant if anything reads via anon)')
} else {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await anon.from('changelog_entries').select('id').limit(1)
  if (error) {
    ok(`anon blocked as expected: ${error.code ?? '?'} — ${error.message}`)
  } else if ((data ?? []).length === 0) {
    ok('anon returns 0 rows (RLS is working)')
  } else {
    bad(`anon returned ${data?.length} rows — RLS is NOT restricting reads`)
  }
}

// -------- 4) ISR připomínka --------

console.log('\n=== 4) ISR / cache ===')
info('/changelog má export const revalidate = 300 (5 min).')
info('Po vložení řádku přímo přes SQL se změna projeví až po 5 minutách,')
info('pokud API endpoint nezavolá revalidatePath("/changelog").')

console.log('')

}

main().catch((e) => { console.error(e); process.exit(1) })
