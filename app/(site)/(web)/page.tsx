import type { Metadata } from 'next'
import { hero } from '@/content/assetra/site'
import { Contact, Contract, Hero, Paths, PricingSection, Process, Quante, Services, Work } from '../_components/home/sections'

export const metadata: Metadata = {
  title: { absolute: 'Assetra Digital — web a e-shop bez vstupní investice' },
  description: hero.lead,
  openGraph: {
    type: 'website',
    locale: 'cs_CZ',
    siteName: 'Assetra Digital',
    title: 'Web nebo e-shop bez vstupní investice',
    description: hero.lead,
  },
  twitter: { card: 'summary_large_image', title: 'Web nebo e-shop bez vstupní investice', description: hero.lead },
}

export default function HomePage() {
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
