import { QboxClient } from './QboxClient'
import { buildMetadata } from '@/lib/seo'
import { isOpenAccess } from '@/lib/qbox/model'

export const metadata = buildMetadata({
  title: 'Qbox — a computer for your AI agent',
  description:
    'Isolated sandboxes for AI agents over one API call or MCP: run code, install packages, use files and preview URLs. Pay per use; agents can pay by themselves (x402).',
  path: '/qbox',
})

export default function QboxPage() {
  return <QboxClient open={isOpenAccess(process.env)} />
}
