// In-memory stand-in for lib/supabase/admin.ts in unit tests: just enough of the PostgREST query
// builder (select / insert / update / delete, eq / neq / lt / gte / is / not-is-null / in, order, limit,
// maybeSingle, count+head) for code that only reads and writes rows. Each statement runs
// atomically when awaited, like a single SQL statement. Tables: __db.tables[name] = rows[].
export const __db = { tables: {}, reset() { this.tables = {} } }

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

const pick = (row, cols) => (!cols || cols === '*' ? { ...row } : Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, row[c] ?? null])))

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
    const rows = (__db.tables[this.table] ??= [])
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

export const supabaseAdmin = { from: (t) => new Query(t) }
