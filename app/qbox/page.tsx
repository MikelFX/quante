import { QboxClient } from './QboxClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Qbox — a computer for your AI agent (closed beta)',
  description:
    'Isolated sandboxes for AI agents on one API call: run code, install packages, use files and open preview URLs. Closed beta.',
  path: '/qbox',
})

export default function QboxPage() {
  return <QboxClient />
}
