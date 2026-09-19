import { ShowcaseClient } from './ShowcaseClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Showcase — real stores built by Quante',
  description:
    'Live stores generated from a one-paragraph brief, running on quantecode.com subdomains. See the interactive Axiom and Mamut demos.',
  path: '/showcase',
})

export default function ShowcasePage() {
  return <ShowcaseClient />
}
