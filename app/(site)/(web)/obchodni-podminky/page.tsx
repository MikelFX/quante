import type { Metadata } from 'next'
import { terms as doc, hasLegalPlaceholders } from '@/content/assetra/legal'
import { LegalDoc } from '../LegalDoc'

// Kept out of search results while the text still shows [placeholders] (company data not filled in yet).
export const metadata: Metadata = {
  title: doc.title,
  description: doc.lead,
  robots: hasLegalPlaceholders(doc) ? { index: false, follow: true } : undefined,
}

export default function Page() {
  return <LegalDoc doc={doc} />
}
