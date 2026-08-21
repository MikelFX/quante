// Deterministic, market-neutral (English) legal page generator for code-gen mode
// stores. Companion to lib/legal-templates.ts (the original Czech-only generator,
// which targets the legacy ShopManifest/Merchant model used by /api/export's legacy
// manifest-mode branch). This one targets the market-neutral BusinessInfo/
// PaymentsInfo/ShippingInfo shapes stored on project_secrets (see
// supabase/migration-business-info.sql) and is consumed by app/api/store/legal/route.ts,
// which the deployed store's app/terms, app/privacy, app/cookies, app/contact pages
// fetch server-side at request time (same hosted-mode pattern as app/api/checkout).
//
// Output is plain structured data (heading + body paragraphs), not HTML — the store's
// page components render it directly as JSX. Templates are a starting point; the
// generated pages say as much and recommend a legal review.

import type { BusinessInfo, PaymentsInfo, ShippingInfo } from '@/types/business'

export const LEGAL_TEMPLATE_VERSION_EN = '1.0'

export interface LegalSection {
  heading?: string
  body: string[] // paragraphs
}

export interface LegalPage {
  title: string
  sections: LegalSection[]
}

const YEAR = new Date().getFullYear()

function fullAddress(b: BusinessInfo): string {
  const parts = [b.street, [b.postalCode, b.city].filter(Boolean).join(' '), b.country].filter(Boolean)
  return parts.join(', ')
}

function paymentList(p: PaymentsInfo | null): string {
  const methods: string[] = []
  if (p?.providers?.length) methods.push('credit/debit card, Apple Pay, Google Pay')
  if (p?.cod?.enabled) methods.push(`cash on delivery${p.cod.fee ? ` (surcharge applies)` : ''}`)
  if (p?.bankTransfer?.enabled) methods.push('bank transfer')
  if (methods.length === 0) methods.push('credit/debit card')
  return methods.join(', ')
}

function shippingList(s: ShippingInfo | null): string {
  if (!s?.methods?.length) return 'the shipping options shown at checkout'
  return s.methods.map((m) => m.label).join(', ')
}

export function generateTermsEn(b: BusinessInfo, p: PaymentsInfo | null, s: ShippingInfo | null): LegalPage {
  return {
    title: 'Terms of Service',
    sections: [
      {
        heading: '1. Seller information',
        body: [
          `These Terms of Service govern purchases made on this website, operated by ${b.name || 'the store operator'}${b.taxId ? ` (registration/company no. ${b.taxId}${b.vatId ? `, VAT ${b.vatId}` : ''})` : ''}, registered at ${fullAddress(b) || 'the address shown on the Contact page'}. Contact: ${b.email || 'see the Contact page'}${b.phone ? `, ${b.phone}` : ''}.`,
        ],
      },
      {
        heading: '2. Orders and contract formation',
        body: [
          'By placing an order through this website, you make a binding offer to purchase the selected goods. A contract of sale is formed once we confirm your order by email or by displaying an order confirmation.',
          'We reserve the right to decline or cancel an order, for example in cases of unavailable stock or a pricing error, in which case any payment already made will be refunded in full.',
        ],
      },
      {
        heading: '3. Prices and payment',
        body: [
          'All prices shown at checkout are final and include any applicable taxes unless stated otherwise.',
          `Accepted payment methods: ${paymentList(p)}.`,
        ],
      },
      {
        heading: '4. Shipping',
        body: [
          `We ship using ${shippingList(s)}. Estimated delivery times are shown at checkout and are not guaranteed unless explicitly stated.`,
          s?.freeShippingFrom ? `Orders above the threshold shown at checkout qualify for free shipping.` : '',
        ].filter(Boolean),
      },
      {
        heading: '5. Right of withdrawal / returns',
        body: [
          'Where applicable law grants you a right of withdrawal, you may cancel your order within the statutory period after receiving the goods, without giving any reason. To exercise this right, contact us using the details above. Goods should be returned in their original condition where reasonably possible.',
        ],
      },
      {
        heading: '6. Warranty and liability',
        body: [
          'Statutory warranty rights apply as required by the law of your jurisdiction. Nothing in these terms limits any rights that cannot be excluded under applicable consumer protection law.',
        ],
      },
      {
        heading: '7. Governing law',
        body: [
          `These terms are governed by the laws applicable at the seller's registered address${b.country ? ` (${b.country})` : ''}, without prejudice to any mandatory consumer-protection rules of your own country of residence.`,
        ],
      },
      {
        body: [`Last updated: ${YEAR}. This document is a template and does not constitute legal advice — we recommend a legal review before relying on it.`],
      },
    ],
  }
}

export function generatePrivacyEn(b: BusinessInfo): LegalPage {
  return {
    title: 'Privacy Policy',
    sections: [
      {
        heading: '1. Data controller',
        body: [
          `${b.name || 'The store operator'} is the data controller responsible for your personal data collected through this website. Contact: ${b.email || 'see the Contact page'}${fullAddress(b) ? `, ${fullAddress(b)}` : ''}.`,
        ],
      },
      {
        heading: '2. What we collect',
        body: [
          'When you place an order, we collect the information necessary to process it: your name, delivery and billing address, email address, phone number, and order details. When you browse the site, we may also collect technical data such as IP address and browser type via cookies (see our Cookie Policy).',
        ],
      },
      {
        heading: '3. Why we process it',
        body: [
          'We process your data to fulfil orders, handle payments and shipping, respond to inquiries, comply with legal obligations (e.g. invoicing and tax records), and — where you have consented — to send order-related and marketing communications.',
        ],
      },
      {
        heading: '4. Who we share it with',
        body: [
          'We share data only with service providers necessary to run the store: payment processors, shipping carriers, and email/infrastructure providers, each acting under their own data protection obligations. We do not sell your personal data.',
        ],
      },
      {
        heading: '5. Your rights',
        body: [
          'Depending on your jurisdiction, you may have the right to access, correct, delete, or export your personal data, and to object to or restrict certain processing. To exercise these rights, contact us using the details above.',
        ],
      },
      {
        heading: '6. Data retention',
        body: [
          'We retain order and invoicing data for as long as required by applicable tax and accounting law, and other personal data only for as long as necessary for the purposes described above.',
        ],
      },
      {
        body: [`Last updated: ${YEAR}. This document is a template and does not constitute legal advice — we recommend a legal review before relying on it.`],
      },
    ],
  }
}

export function generateCookiesEn(b: BusinessInfo): LegalPage {
  return {
    title: 'Cookie Policy',
    sections: [
      {
        heading: '1. What are cookies',
        body: [
          'Cookies are small text files stored on your device when you visit a website. This site uses cookies to make the store work correctly and, where you consent, to understand how it is used.',
        ],
      },
      {
        heading: '2. Cookies we use',
        body: [
          'Essential cookies: required for core functionality such as the shopping cart and checkout. These cannot be disabled without breaking the site.',
          'Analytics cookies (optional): help us understand site usage in aggregate. Only set with your consent.',
        ],
      },
      {
        heading: '3. Managing cookies',
        body: [
          'You can manage or withdraw your cookie consent at any time using the cookie banner shown on your first visit, or through your browser settings.',
        ],
      },
      {
        body: [`Last updated: ${YEAR}. Contact ${b.email || 'us via the Contact page'} with any questions about this policy.`],
      },
    ],
  }
}

export function generateContactEn(b: BusinessInfo): LegalPage {
  const lines: string[] = []
  if (b.name) lines.push(b.name)
  if (fullAddress(b)) lines.push(fullAddress(b))
  if (b.email) lines.push(`Email: ${b.email}`)
  if (b.phone) lines.push(`Phone: ${b.phone}`)
  if (b.taxId) lines.push(`Company/registration no.: ${b.taxId}`)
  if (b.vatId) lines.push(`VAT: ${b.vatId}`)
  return {
    title: 'Contact',
    sections: [
      {
        body: lines.length ? lines : ['Contact details have not been added yet.'],
      },
    ],
  }
}
