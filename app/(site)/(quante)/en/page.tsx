import type { Metadata } from 'next'
import { quanteIntroFor } from '@/content/assetra/modules'
import { QuanteOverview } from '../../_components/quante/QuanteOverview'
import { quanteShare } from '../../_components/seo'

// quantecode.com/en: the Quante overview in English (owner 2026-11-07). Czech at quantecode.com/.
const intro = quanteIntroFor('en')

export const metadata: Metadata = {
  title: { absolute: 'Quante — your whole online store in one place' },
  description: intro.sub + ' Generate, Qscan, Qgent with 20 agents, Qdit, Qads and more in one connected app.',
  ...quanteShare({ path: '/en', title: 'Quante — your whole online store in one place', description: intro.sub, locale: 'en', alternate: { cs: '/', en: '/en' } }),
}

export default function QuanteEnPage() {
  return <QuanteOverview locale="en" />
}
