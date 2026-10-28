import { QscanClient } from './QscanClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Qscan — rebuild your store from its address',
  description:
    'Paste your e-shop’s address. Qscan takes its products, photos, videos and copy and builds a new, better-looking store in Quante.',
  path: '/qscan',
})

export default function QscanPage() {
  return <QscanClient />
}
