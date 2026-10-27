import type { Metadata } from 'next'
import { hero } from '@/content/assetra/site'
import { siteShare } from '../../_components/seo'
import { Contact, Contract, Hero, Paths, PricingSection, Process, Quante, Services, Work } from '../../_components/home/sections'

// Web & Eshop — the former homepage (until 2026-10-26), unchanged: websites and e-shops built
// for a monthly fee, or yourself in Quante.
export const metadata: Metadata = {
  title: 'Web & Eshop — bez vstupní investice',
  description: hero.lead,
  ...siteShare({ path: '/web-eshop', title: 'Web nebo e-shop bez vstupní investice', description: hero.lead }),
}

export default function WebShopPage() {
  return (
    <>
      <Hero />
      <Paths />
      <Services />
      <Contract />
      <PricingSection />
      <Process />
      <Work />
      <Quante />
      <Contact />
    </>
  )
}
