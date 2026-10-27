import type { Metadata } from 'next'
import { aiHero } from '@/content/assetra/ai'
import { siteShare } from '../_components/seo'
import { AiAudience, AiBranka, AiBuilt, AiHero, AiIdeas, AiProcess, AiServices, AiWebShop } from '../_components/ai/sections'
import { Contact } from '../_components/home/sections'

export const metadata: Metadata = {
  title: { absolute: 'Assetra Digital — AI řešení a software na míru' },
  description: aiHero.lead,
  ...siteShare({ path: '/', type: 'website', title: 'AI řešení a software na míru', description: aiHero.lead }),
}

export default function HomePage() {
  return (
    <>
      <AiHero />
      <AiServices />
      <AiAudience />
      <AiIdeas />
      <AiBuilt />
      <AiBranka />
      <AiWebShop />
      <AiProcess />
      <Contact />
    </>
  )
}
