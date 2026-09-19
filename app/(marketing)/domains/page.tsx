import { DomainsClient } from './DomainsClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Domains — connect or buy a custom domain for your store',
  description:
    'Point your own domain at your Quante store — CNAME verified automatically. Or buy a fresh domain via Namecheap without leaving Quante.',
  path: '/domains',
})

export default function DomainsPage() {
  return <DomainsClient />
}
