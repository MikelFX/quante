// Jednorázový codemod existujících obchodů: inline theme styly → Tailwind token třídy
// (lib/store-template/style-codemod.ts). Nové výstupy AI už codemodem procházejí samy
// (generate / iterate / fix); tenhle skript převede to, co obchody mají uložené z dřívějška.
//
// Spuštění (z rootu projektu, Node 24 — TypeScript se načte přímo):
//   node scripts/codemod-inline-styles.mjs            # dry run: jen vypíše, co by se změnilo
//   node scripts/codemod-inline-styles.mjs --apply    # uloží novou verzi kódu u každého obchodu
//   node scripts/codemod-inline-styles.mjs --apply --project <uuid>   # jen jeden obchod
//
// --apply přidá do code_versions NOVOU verzi (prompt "Codemod: inline theme styles → token
// classes") nad poslední verzí projektu. Nic nenasazuje: u živého obchodu je to draft
// (draft/publish), zákazníci ho uvidí až po Publish ve Studiu (proběhne plný build).
// Spouštět až po nasazení platformy se SCAFFOLD_VERSION >= 5 — token třídy potřebují
// @theme bloky, které vkládá buildStoreFiles.
//
// Soubory, které by po převodu neprošly bezpečnostním filtrem, zůstanou beze změny.
// Ověřeno 2026-09-26 na obchodě Dorty: vypočtené styly všech prvků stránky jsou před a po
// převodu shodné.

import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const cm = await import(new URL('lib/store-template/style-codemod.ts', ROOT).href)
const build = await import(new URL('lib/store-template/build.ts', ROOT).href)

const env = Object.fromEntries(
  readFileSync(new URL('.env.local', ROOT), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }),
)
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE || !KEY) throw new Error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const onlyProject = args.includes('--project') ? args[args.indexOf('--project') + 1] : null
if (onlyProject && !/^[0-9a-f-]{36}$/i.test(onlyProject)) throw new Error('--project needs a project uuid')

async function rest(path, init) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, { headers, ...init })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const projects = await rest(`projects?select=id,name,user_id,status${onlyProject ? `&id=eq.${onlyProject}` : ''}&status=neq.deleted`)
let totalConverted = 0
for (const p of projects) {
  const [latest] = await rest(`code_versions?select=id,version_no,files&project_id=eq.${p.id}&order=version_no.desc&limit=1`)
  if (!latest) continue
  const { changed, converted, remainingStyleAttrs } = cm.convertStoreFiles(latest.files)
  const safe = {}
  for (const [path, code] of Object.entries(changed)) {
    const why = build.rejectAiStoreFile(path, code)
    if (why) console.warn(`  ! ${p.name}: ${path} left unchanged (${why})`)
    else safe[path] = code
  }
  const n = Object.keys(safe).length
  console.log(`${p.name} (${p.id}) v${latest.version_no}: ${converted} style properties → classes in ${n} files, ${remainingStyleAttrs} style attributes left`)
  if (!apply || n === 0) continue
  const [row] = await rest('code_versions?select=id,version_no', {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      project_id: p.id,
      user_id: p.user_id,
      version_no: latest.version_no + 1,
      files: { ...latest.files, ...safe },
      prompt: 'Codemod: inline theme styles → token classes',
    }),
  })
  console.log(`  saved draft v${row.version_no} (${row.id}) — publish it from the Studio`)
  totalConverted += converted
}
console.log(apply ? `\nDone — ${totalConverted} style properties converted.` : '\nDry run — nothing saved. Re-run with --apply.')
