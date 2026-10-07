import type { Metadata } from 'next'
import { DocPlaceholder } from '../DocPlaceholder'

// Not written yet — kept out of search results until the real text is in.
export const metadata: Metadata = { title: 'Ochrana osobních údajů', robots: { index: false, follow: true } }

export default function Page() {
  return <DocPlaceholder title="Ochrana osobních údajů" />
}
