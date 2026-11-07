import type { Metadata } from 'next'
import { quanteIntro } from '@/content/assetra/modules'
import { QuanteOverview } from '../../_components/quante/QuanteOverview'
import { quanteShare } from '../../_components/seo'

// quantecode.com/ (next.config.ts rewrites the app host's root here): every Quante product and how
// they connect. The canonical URL is the root of the app host; English at /en.
export const metadata: Metadata = {
  title: { absolute: 'Quante — celý e-shop na jednom místě' },
  description: quanteIntro.sub + ' Generate, Qscan, Qgent s 20 agenty, Qdit, Qads a další produkty v jednom propojeném celku.',
  ...quanteShare({ path: '/', title: 'Quante — celý e-shop na jednom místě', description: quanteIntro.sub, alternate: { cs: '/', en: '/en' } }),
}

export default function QuantePage() {
  return <QuanteOverview />
}
