import { QadsGeneratorClient } from './QadsGeneratorClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Qads — ad video + photo generator from a single product photo',
  description:
    'Upload a product photo, pick a style and formats. Qads produces ad videos and photos you can download individually or as a ZIP — where you post them is up to you.',
  path: '/qads',
})

export default function QadsPage() {
  return <QadsGeneratorClient />
}
