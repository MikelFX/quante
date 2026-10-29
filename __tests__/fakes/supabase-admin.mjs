// In-memory stand-in for lib/supabase/admin.ts in unit tests: just enough of the PostgREST query
// builder (select / insert / update / delete, eq / neq / lt / gte / is / not-is-null / in, order, limit,
// maybeSingle, count+head) for code that only reads and writes rows. Each statement runs
// atomically when awaited, like a single SQL statement. Tables: __db.tables[name] = rows[].
// __db.missing: tables that "don't exist yet" (a migration that hasn't run); __db.missingColumns:
// { table: [column] } — a select naming one answers the PostgREST unknown-column error.
export const __db = { tables: {}, signed: [], objects: {}, missing: new Set(), missingColumns: {}, reset() { this.tables = {}; this.signed = []; this.objects = {}; this.missing = new Set(); this.missingColumns = {} } }

function matches(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col]
    switch (op) {
      case 'eq': return v === val
      case 'neq': return v !== val
      case 'lt': return v < val
      case 'gte': return v >= val
      case 'is': return val === null ? v === null || v === undefined : v === val
      case 'notnull': return v !== null && v !== undefined
      case 'in': return val.includes(v)
      default: throw new Error('fake supabase: unsupported filter ' + op)
    }
  })
}

// A column spec: `col`, `alias:col`, JSON paths `alias:col->a->>"b/c.ts"`; embedded resources
// (`table!inner(cols)`) are left out of the result.
function column(row, spec) {
  const m = spec.match(/^(?:(\w+):)?(\w+)((?:->>?(?:"[^"]+"|\w+))*)$/)
  if (!m) return null
  const [, alias, col, path] = m
  let v = row[col]
  for (const [, op, key] of path.matchAll(/(->>?)(?:"([^"]+)"|(\w+))/g).map((x) => [x[0], x[1], x[2] ?? x[3]])) {
    v = v == null ? null : v[key] ?? null
    if (op === '->>' && v != null && typeof v !== 'string') v = JSON.stringify(v)
  }
  return [alias ?? col, v ?? null]
}
const pick = (row, cols) => (!cols || cols === '*'
  ? { ...row }
  : Object.fromEntries(cols.split(/,(?![^(]*\))/).map((c) => c.trim()).filter((c) => !c.includes('(')).map((c) => column(row, c)).filter(Boolean)))

class Query {
  constructor(table) {
    this.table = table
    this.kind = 'select'
    this.filters = []
    this.orders = []
    this.max = Infinity
    this.single = false
    this.cols = '*'
    this.countHead = false
    this.returning = false
  }
  select(cols = '*', opts) {
    if (this.kind === 'select') { this.cols = cols; this.countHead = !!(opts && opts.head) } else { this.returning = true; this.cols = cols }
    return this
  }
  insert(rows) { this.kind = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this }
  update(patch) { this.kind = 'update'; this.patch = patch; return this }
  upsert(row, { onConflict = 'id' } = {}) { this.kind = 'upsert'; this.rows = Array.isArray(row) ? row : [row]; this.conflict = onConflict; return this }
  delete() { this.kind = 'delete'; return this }
  eq(c, v) { this.filters.push(['eq', c, v]); return this }
  neq(c, v) { this.filters.push(['neq', c, v]); return this }
  lt(c, v) { this.filters.push(['lt', c, v]); return this }
  gte(c, v) { this.filters.push(['gte', c, v]); return this }
  is(c, v) { this.filters.push(['is', c, v]); return this }
  not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('fake supabase: only not(col, "is", null)'); this.filters.push(['notnull', c]); return this }
  in(c, v) { this.filters.push(['in', c, v]); return this }
  order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this }
  limit(n) { this.max = n; return this }
  maybeSingle() { this.single = true; return this }
  run() {
    if (__db.missing.has(this.table)) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } }
    const gone = (__db.missingColumns[this.table] ?? []).find((c) => new RegExp(`\\b${c}\\b`).test(this.cols ?? '') || Object.keys(this.patch ?? {}).includes(c))
    if (gone) return { data: null, error: { code: '42703', message: `column ${this.table}.${gone} does not exist` } }
    const rows = (__db.tables[this.table] ??= [])
    if (this.kind === 'upsert') {
      for (const r of this.rows) {
        const hit = rows.find((x) => x[this.conflict] === r[this.conflict])
        if (hit) Object.assign(hit, r)
        else rows.push({ created_at: new Date().toISOString(), ...r })
      }
      return { data: null, error: null }
    }
    if (this.kind === 'insert') {
      const now = new Date().toISOString()
      for (const r of this.rows) rows.push({ created_at: now, ...r })
      return { data: this.returning ? this.rows.map((r) => pick(r, this.cols)) : null, error: null }
    }
    let hit = rows.filter((r) => matches(r, this.filters))
    if (this.kind === 'delete') {
      __db.tables[this.table] = rows.filter((r) => !hit.includes(r))
      return { data: null, error: null }
    }
    if (this.kind === 'update') {
      for (const r of hit) Object.assign(r, this.patch)
      const out = hit.map((r) => pick(r, this.cols))
      return { data: this.single ? out[0] ?? null : this.returning ? out : null, error: null }
    }
    for (const [c, asc] of [...this.orders].reverse()) hit = [...hit].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1))
    hit = hit.slice(0, this.max)
    if (this.countHead) return { count: hit.length, data: null, error: null }
    const out = hit.map((r) => pick(r, this.cols))
    return { data: this.single ? out[0] ?? null : out, error: null }
  }
  then(resolve, reject) { try { resolve(this.run()) } catch (e) { reject(e) } }
}

// Storage: signed URLs are recorded in __db.signed so tests can see what was signed. Objects live
// in __db.objects[`${bucket}/${path}`] = Buffer (download / upload / createSignedUrl).
const storage = {
  from: (bucket) => ({
    download: async (path) => {
      const buf = (__db.objects ??= {})[`${bucket}/${path}`]
      return buf ? { data: new Blob([buf]), error: null } : { data: null, error: { message: 'Object not found' } }
    },
    upload: async (path, buf) => { (__db.objects ??= {})[`${bucket}/${path}`] = buf; return { data: { path }, error: null } },
    createSignedUrl: async (path, ttl) => {
      ;(__db.signed ??= []).push({ bucket, paths: [path], ttl, download: false })
      return { data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${ttl}` }, error: null }
    },
    createSignedUrls: async (paths, ttl, opts) => {
      ;(__db.signed ??= []).push({ bucket, paths, ttl, download: !!opts?.download })
      return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${bucket}/${p}?ttl=${ttl}${opts?.download ? '&download=' : ''}` })), error: null }
    },
  }),
}

export const supabaseAdmin = { from: (t) => new Query(t), storage }
