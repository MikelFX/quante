import { QadsClient } from './QadsClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Qads — turn your store into a Meta & TikTok campaign',
  description:
    'Same store, one more description away from a full ad campaign — strategy, copy, creatives and video, drafted and paused for your review.',
  path: '/qads',
})

export default function QadsPage() {
  return <QadsClient />
}
