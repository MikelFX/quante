import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { moduleBySlug, modules } from '@/content/assetra/modules'
import { ModulePage } from '../../../_components/quante/ModulePage'

export const dynamicParams = false

export function generateStaticParams() {
  return modules.map((m) => ({ modul: m.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ modul: string }> }): Promise<Metadata> {
  const m = moduleBySlug((await params).modul)
  if (!m) return {}
  const title = `${m.name}${m.status === 'dev' ? ' (ve vývoji)' : ''}`
  return {
    title,
    description: m.lead,
    openGraph: { locale: 'cs_CZ', siteName: 'Assetra Digital', title: `${m.name} · Quante`, description: m.lead },
  }
}

export default async function ModuleRoute({ params }: { params: Promise<{ modul: string }> }) {
  const m = moduleBySlug((await params).modul)
  if (!m) notFound()
  return <ModulePage m={m} />
}
