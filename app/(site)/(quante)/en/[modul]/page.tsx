import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { moduleBySlug, modules } from '@/content/assetra/modules'
import { ModulePage } from '../../../_components/quante/ModulePage'
import { quanteShare } from '../../../_components/seo'

// quantecode.com/en/<modul>: a Quante module in English. Czech at quantecode.com/quante/<modul>.
export const dynamicParams = false

export function generateStaticParams() {
  return modules.map((m) => ({ modul: m.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ modul: string }> }): Promise<Metadata> {
  const m = moduleBySlug((await params).modul, 'en')
  if (!m) return {}
  const title = `${m.name}${m.status === 'dev' ? ' (in development)' : ''}`
  return {
    title,
    description: m.lead,
    ...quanteShare({ path: `/en/${m.slug}`, title: `${m.name} · Quante`, description: m.lead, locale: 'en', alternate: { cs: `/quante/${m.slug}`, en: `/en/${m.slug}` } }),
  }
}

export default async function ModuleEnRoute({ params }: { params: Promise<{ modul: string }> }) {
  const m = moduleBySlug((await params).modul, 'en')
  if (!m) notFound()
  return <ModulePage m={m} locale="en" />
}
