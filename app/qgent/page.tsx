import { QgentSwarmClient } from './QgentSwarmClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Qgent — 20 agents go through your store',
  description:
    'Paste your e-shop’s address: twenty agents go through it live and suggest changes you accept or reject, or build you a new store from the old one.',
  path: '/qgent',
})

export default function QgentPage() {
  return <QgentSwarmClient />
}
