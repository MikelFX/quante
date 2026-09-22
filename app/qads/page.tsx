import { QadsGeneratorClient } from './QadsGeneratorClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Qads — generátor reklamních videí a fotek z jedné fotky produktu',
  description:
    'Nahraj fotku produktu, vyber styl a formáty. Qads vytvoří reklamní videa a fotky, ke stažení jednotlivě nebo v ZIPu — kam je nahraješ je na tobě.',
  path: '/qads',
})

export default function QadsPage() {
  return <QadsGeneratorClient />
}
