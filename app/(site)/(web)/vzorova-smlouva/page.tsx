import type { Metadata } from 'next'
import { DocPlaceholder } from '../DocPlaceholder'

// Not written yet — kept out of search results until the real text is in.
export const metadata: Metadata = { title: 'Vzorová smlouva', robots: { index: false, follow: true } }

export default function Page() {
  return <DocPlaceholder title="Vzorová smlouva" />
}
