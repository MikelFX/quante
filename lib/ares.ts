export interface AresResult {
  obchodni_nazev: string
  dic: string | null
  sidlo: {
    ulice: string
    mesto: string
    psc: string
  }
}

export async function lookupIco(ico: string): Promise<AresResult | null> {
  try {
    const res = await fetch(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`,
      { next: { revalidate: 3600 } }
    )
    if (!res.ok) return null
    const data = await res.json()

    const sidlo = data.sidlo ?? {}
    const ulice = [sidlo.nazevUlice, sidlo.cisloDomovni, sidlo.cisloOrientacni]
      .filter(Boolean)
      .join(' ')
      .trim()

    return {
      obchodni_nazev: data.obchodniJmeno ?? '',
      dic: data.dic ?? null,
      sidlo: {
        ulice: ulice || '',
        mesto: sidlo.nazevObce ?? '',
        psc: String(sidlo.psc ?? '').replace(/\s/g, ''),
      },
    }
  } catch {
    return null
  }
}
