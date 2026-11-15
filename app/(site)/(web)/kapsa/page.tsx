import type { Metadata } from 'next'
import { kapsa } from '@/content/assetra/kapsa'
import { siteShare } from '../../_components/seo'
import { KapsaEnd, KapsaFacts, KapsaFeatures, KapsaHero, KapsaHonest, KapsaSteps } from '../../_components/kapsa/sections'

// Kapsa: our AI personal-finance coach (content/assetra/kapsa.ts). Its own app and domain; this is
// its page on the AssetraDigital website.
export const metadata: Metadata = {
  title: `${kapsa.name}: AI kouč osobních financí`,
  description: kapsa.description,
  ...siteShare({ path: kapsa.path, title: `${kapsa.name}: AI kouč osobních financí`, description: kapsa.description }),
}

export default function KapsaPage() {
  return (
    <>
      <KapsaHero />
      <KapsaFeatures />
      <KapsaSteps />
      <KapsaHonest />
      <KapsaFacts />
      <KapsaEnd />
    </>
  )
}
