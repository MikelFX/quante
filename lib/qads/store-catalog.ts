// The products of a user's Quante stores, for Qads (the @ picker in /qads and Qads Plan).
// Code-generated stores (the current kind): data/products.ts of the latest code version, parsed
// as a literal (lib/store-products.ts) or, when the file uses constants, read leniently for names
// + descriptions only. Older manifest stores: the latest manifest_versions catalog. Read-only;
// callers check project ownership.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { PRODUCTS_FILE, parseProductsFile } from '@/lib/store-products'

export interface ManifestProduct {
  id: string
  name: string
  description?: string
  images?: string[]
  price?: number
  slug?: string
}

export interface ManifestSlice {
  brand?: { name?: string }
  catalog?: { products?: ManifestProduct[] }
}

export interface PickerProduct { id: string; name: string; description: string; images: string[] }

/** The value of `key: "…"` (any quote style) in a piece of source, or null. */
function stringField(body: string, key: string): string | null {
  const m = body.match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*?)\\1`))
  // Unescape \" \' \\ and friends: the text as a shopper sees it.
  return m ? m[2].replace(/\\(.)/g, '$1') : null
}

/** Names and descriptions from a data/products.ts that isn't a plain literal. */
function readProductsLeniently(src: string): PickerProduct[] {
  const out: PickerProduct[] = []
  // Every "{" opens a chunk; products carry a slug, their variants don't.
  for (const chunk of src.split('{').slice(1)) {
    const body = chunk.split('}')[0]
    if (!/\bslug\s*:/.test(body)) continue
    const name = stringField(body, 'name')
    if (!name) continue
    out.push({
      id: stringField(body, 'id') ?? String(out.length + 1),
      name: name.slice(0, 120),
      description: (stringField(body, 'description') ?? '').slice(0, 600),
      images: [],
    })
    if (out.length >= 60) break
  }
  return out
}

export function productsFromCode(files: Record<string, string> | null | undefined): PickerProduct[] {
  const src = files?.[PRODUCTS_FILE]
  if (typeof src !== 'string') return []
  const parsed = parseProductsFile(src)
  if (parsed) {
    return parsed.slice(0, 60).map((p) => ({
      id: String(p.id),
      name: p.name,
      description: p.description ?? '',
      images: (p.images ?? []).slice(0, 4),
    }))
  }
  return readProductsLeniently(src)
}

export function productsFromManifest(manifest: ManifestSlice | null | undefined): PickerProduct[] {
  return (manifest?.catalog?.products ?? []).slice(0, 60).map(prod => ({
    id: prod.id,
    name: prod.name,
    description: prod.description ?? '',
    images: (prod.images ?? []).slice(0, 4),
  }))
}

/** One store's products: the latest code version, else the latest manifest. */
export async function loadStoreProducts(projectId: string): Promise<PickerProduct[]> {
  const { data } = await supabaseAdmin
    .from('code_versions')
    .select('files')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const fromCode = productsFromCode((data?.files as Record<string, string> | undefined) ?? null)
  if (fromCode.length) return fromCode
  const { data: m } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return productsFromManifest((m?.manifest as ManifestSlice | undefined) ?? null)
}
