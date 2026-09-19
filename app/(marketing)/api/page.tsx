import { ApiClient } from './ApiClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'API — programmatic store generation (planned)',
  description:
    'The same manifest pipeline the Studio uses, exposed as a stable HTTP API — generate, iterate and export stores directly from your own tooling.',
  path: '/api',
})

export default function ApiPage() {
  return <ApiClient />
}
