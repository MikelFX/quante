import { AboutClient } from './AboutClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'About Quante — you build the work, you keep the code',
  description:
    'Quante hands you the source. What you generate here is a real Next.js project you own outright — export any time, host anywhere.',
  path: '/about',
})

export default function AboutPage() {
  return <AboutClient />
}
