import { ContactClient } from './ContactClient'
import { buildMetadata } from '@/lib/seo'

export const metadata = buildMetadata({
  title: 'Contact Quante',
  description:
    'Reach the Quante team — press, partnerships, product feedback and general questions all go here. Response within one business day.',
  path: '/contact',
})

export default function ContactPage() {
  return <ContactClient />
}
