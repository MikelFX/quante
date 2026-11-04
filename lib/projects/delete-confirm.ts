// Deleting a store asks the owner to type its name again (owner, 2026-11-04). The same rule runs
// in the dialog (the Delete button stays disabled) and in DELETE /api/projects/[id] (the request is
// refused without it), so a stray click or a replayed request can never remove a store.
//
// Exact match after trimming and collapsing whitespace; case matters. Unicode is NFC-normalized so
// a name typed on another keyboard (é as one or two code points) still matches.

export function normalizeStoreName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function deleteNameMatches(typed: unknown, storeName: unknown): boolean {
  const want = normalizeStoreName(storeName)
  return want.length > 0 && normalizeStoreName(typed) === want
}
