// DRAFT — must be reviewed by a qualified lawyer before relying on this in
// production, especially given cross-border Stripe Connect payments and GDPR obligations.
//
// BUSINESS DECISION REQUIRED: The refund window below is set to 14 days.
// Adjust this figure to match your actual policy before going live.
// Also confirm whether the "hosted-store" hosting subscription is refundable,
// and update Section 3 accordingly.

import type { Metadata } from 'next'
import { operator } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Refund Policy — Quante',
  description: 'Quante refund policy for credits and hosting subscriptions.',
}

const EFFECTIVE = '1 July 2026'
// BUSINESS DECISION: adjust the refund window before going live.
const REFUND_WINDOW_DAYS = 14

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--qp-ink)', marginBottom: 12, letterSpacing: '-.02em' }}>{title}</h2>
      <div style={{ fontSize: 14, color: 'var(--qp-sub)', lineHeight: 1.75 }}>{children}</div>
    </section>
  )
}

export default function RefundPage() {
  const email = operator.contactEmail && !operator.contactEmail.includes('[TO') ? operator.contactEmail : null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--qp-mut)', textTransform: 'uppercase', marginBottom: 12 }}>
        Legal
      </p>
      <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 8, color: 'var(--qp-ink)' }}>
        Refund Policy
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--qp-mut)', marginBottom: 48 }}>
        Effective {EFFECTIVE} · {operator.name}
      </p>

      <Section title="1. Credits">
        <p><strong style={{ color: 'var(--qp-ink)' }}>Unused purchased credits.</strong> If you have purchased a credit pack and have not spent those credits, you may request a full refund within {REFUND_WINDOW_DAYS} days of the original purchase. To request a refund, contact us using the details in Section 5 and include the email address on your account and the approximate date of purchase. We will process the refund to your original payment method within 10 business days.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Partially used credit packs.</strong> If you have spent some but not all credits from a pack, only the value of the remaining (unspent) credits is eligible for a pro-rata refund, subject to the {REFUND_WINDOW_DAYS}-day window above.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Credits already spent on generation.</strong> Credits that have been consumed to generate, iterate, or export a store are non-refundable, regardless of whether you are satisfied with the output. This is because the underlying AI API costs are incurred at the point of generation.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: 'var(--qp-ink)' }}>Complimentary starter credits.</strong> The 25 credits granted to new accounts at sign-up are complimentary and non-refundable in all circumstances.</p>
      </Section>

      <Section title="2. Domain purchases">
        <p>Domain registrations are processed through Namecheap and are generally non-refundable once the registration is confirmed, as the domain is immediately registered in your name with the relevant registry. Exceptions may apply if a registration fails technically — in that case we will investigate and issue a full refund if the domain was charged but not successfully registered.</p>
        <p style={{ marginTop: 10 }}>Domain renewals follow the same policy: once a renewal is processed, the charge is non-refundable.</p>
      </Section>

      <Section title="3. Hosting subscription">
        <p>If Quante offers a recurring hosting subscription, the first {REFUND_WINDOW_DAYS} days after initial purchase are eligible for a full refund if you have not made significant use of the hosting service (i.e., you have not published a live store). After this window, the current billing period is non-refundable but you can cancel to prevent future renewals at any time.</p>
      </Section>

      <Section title="4. EU consumer right of withdrawal">
        <p>If you are a consumer in the European Union, you have a statutory 14-day right of withdrawal from distance contracts. However, by purchasing credits and beginning to use them (or by starting a domain registration), you expressly consent to the immediate performance of the service, acknowledging that the right of withdrawal is lost once the service has been fully performed.</p>
        <p style={{ marginTop: 10 }}>For credits that have not been used at all within 14 days of purchase, the statutory withdrawal right applies in full.</p>
      </Section>

      <Section title="5. How to request a refund">
        <p>
          Contact us{email
            ? <> at <a href={`mailto:${email}`} style={{ color: 'var(--qp-accent)' }}>{email}</a></>
            : ' using the contact information in our Terms of Service'
          } with:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>The email address on your account</li>
          <li>The date and approximate amount of the purchase</li>
          <li>A brief description of your request</li>
        </ul>
        <p style={{ marginTop: 10 }}>We aim to respond within 3 business days and process approved refunds within 10 business days. Refunds are returned to the original payment method only.</p>
      </Section>

      <Section title="6. Changes to this policy">
        <p>We may update this policy from time to time. Any changes will be communicated with at least 14 days' notice before they take effect. The policy in force at the time of your purchase governs any refund request for that purchase.</p>
      </Section>
    </div>
  )
}
