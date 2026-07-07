// DRAFT — must be reviewed by a qualified lawyer before relying on this in
// production, especially given cross-border Stripe Connect payments and GDPR obligations.

import type { Metadata } from 'next'
import { operator } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Terms of Service — Quante',
  description: 'Terms governing use of the Quante platform.',
}

const EFFECTIVE = '1 July 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f4f4f6', marginBottom: 12, letterSpacing: '-.02em' }}>{title}</h2>
      <div style={{ fontSize: 14, color: '#8a8a93', lineHeight: 1.75 }}>{children}</div>
    </section>
  )
}

export default function TermsPage() {
  const email = operator.contactEmail && !operator.contactEmail.includes('[TO') ? operator.contactEmail : null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(4rem,8vw,7rem) 1.5rem' }}>
      <p style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.12em', color: '#5b5b64', textTransform: 'uppercase', marginBottom: 12 }}>
        Legal
      </p>
      <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, letterSpacing: '-.035em', marginBottom: 8, color: '#f4f4f6' }}>
        Terms of Service
      </h1>
      <p style={{ fontSize: 13.5, color: '#5b5b64', marginBottom: 48 }}>
        Effective {EFFECTIVE} · {operator.name}
      </p>

      <Section title="1. Acceptance">
        <p>By creating an account or using the Quante platform ("Service"), you agree to these Terms of Service ("Terms"). If you do not agree, do not use the Service.</p>
        <p style={{ marginTop: 10 }}>The Service is operated by {operator.name}, {operator.address} ("Quante", "we", "us", "our").</p>
      </Section>

      <Section title="2. Description of the Service">
        <p>Quante is a software-as-a-service (SaaS) platform that uses artificial intelligence to help users design, build, and deploy e-commerce storefronts. The core workflow is:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>You describe the store you want via the conversational interface ("Studio").</li>
          <li>Quante generates a Shop Manifest (a structured JSON description of your store's design, content, and products) using Claude, an AI model provided by Anthropic, PBC.</li>
          <li>The manifest is rendered into a Next.js storefront template and optionally deployed to a Vercel-hosted URL or exported as a ZIP file for self-hosting.</li>
        </ul>
        <p style={{ marginTop: 10 }}>We reserve the right to modify, suspend, or discontinue any part of the Service with reasonable notice.</p>
      </Section>

      <Section title="3. Accounts">
        <p>You must be at least 16 years old and provide accurate registration information. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account.</p>
        <p style={{ marginTop: 10 }}>Accounts are personal and may not be transferred without our prior written consent.</p>
      </Section>

      <Section title="4. Credits and billing">
        <p>Access to AI-powered generation features ("Credits") is purchased in advance via Stripe. Credits are non-transferable and expire only as stated at the time of purchase.</p>
        <p style={{ marginTop: 8 }}>Standard credit costs at the time of these Terms:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Full store generation: 10 credits</li>
          <li>Iteration / patch: 1 credit</li>
          <li>Section regeneration: 2 credits</li>
          <li>Custom component generation: 3 credits</li>
          <li>Export to ZIP: 5 credits</li>
          <li>Production deploy: 5 credits</li>
        </ul>
        <p style={{ marginTop: 10 }}>All prices are in EUR unless otherwise stated and include applicable VAT where required. Credit costs may change; we will provide at least 14 days' notice before any change takes effect.</p>
        <p style={{ marginTop: 10 }}>New accounts receive a complimentary grant of 25 credits. These credits are non-refundable.</p>
      </Section>

      <Section title="5. Acceptable use">
        <p>You may not use the Service to generate content that:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>violates any applicable law or regulation</li>
          <li>infringes the intellectual property rights of any third party</li>
          <li>constitutes fraud, phishing, or misrepresentation</li>
          <li>is defamatory, harassing, or promotes hatred or violence</li>
          <li>contains malware, ransomware, or any harmful code</li>
        </ul>
        <p style={{ marginTop: 10 }}>You may not attempt to reverse-engineer, probe, or disrupt the Service's infrastructure. We may suspend or terminate accounts that violate these restrictions without refund.</p>
      </Section>

      <Section title="6. Intellectual property">
        <p><strong style={{ color: '#f4f4f6' }}>Your content.</strong> You retain ownership of any content, product descriptions, images, and other materials you upload or provide to the Service.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: '#f4f4f6' }}>Generated output.</strong> The storefront code, manifests, and other files generated by Quante on your behalf are owned by you. Quante grants you a perpetual, worldwide, royalty-free licence to use, modify, and distribute this output, including for commercial purposes. The generated output carries no Quante branding, watermarks, or telemetry.</p>
        <p style={{ marginTop: 10 }}><strong style={{ color: '#f4f4f6' }}>Platform.</strong> The Quante platform, its codebase, design system, and AI scaffolding remain the exclusive property of {operator.name}. Nothing in these Terms transfers any rights in the platform to you.</p>
      </Section>

      <Section title="7. AI-generated content disclaimer">
        <p>AI-generated content (including copy, product descriptions, and design suggestions) is provided as a starting point and may not always be accurate, appropriate, or fit for purpose. You are responsible for reviewing and editing all AI-generated content before publishing it to the public. Quante makes no warranty regarding the accuracy, originality, or fitness of AI-generated output.</p>
      </Section>

      <Section title="8. Third-party services">
        <p>The Service integrates with third-party providers including Stripe (payments), Vercel (hosting), Anthropic (AI), Clerk (authentication), and Namecheap (domain registration). Your use of these services is also subject to their respective terms and privacy policies. We are not responsible for the acts or omissions of third-party providers.</p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>To the maximum extent permitted by applicable law, Quante shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business, arising out of or in connection with the Service.</p>
        <p style={{ marginTop: 10 }}>Our total liability to you for any claim arising under these Terms shall not exceed the total amounts paid by you to us in the twelve months preceding the claim.</p>
        <p style={{ marginTop: 10 }}>Nothing in these Terms limits our liability for fraud, gross negligence, or death or personal injury caused by our negligence.</p>
      </Section>

      <Section title="10. Warranty disclaimer">
        <p>The Service is provided "as is" and "as available" without warranties of any kind, express or implied. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components.</p>
      </Section>

      <Section title="11. Termination">
        <p>You may close your account at any time. We may suspend or terminate your access if you materially breach these Terms or if required by law, with notice where reasonably practicable.</p>
        <p style={{ marginTop: 10 }}>Upon termination, your right to use the Service ends. You may export your generated projects before closing your account. Unused purchased credits may be refunded as described in our Refund Policy.</p>
      </Section>

      <Section title="12. Governing law and disputes">
        <p>These Terms are governed by the laws of the Czech Republic. Any dispute arising from these Terms that cannot be resolved amicably shall be submitted to the competent courts of the Czech Republic.</p>
        <p style={{ marginTop: 10 }}>If you are a consumer in the EU, you also have the right to use the European Commission's Online Dispute Resolution platform: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" style={{ color: '#6f78e6' }}>ec.europa.eu/consumers/odr</a>.</p>
      </Section>

      <Section title="13. Changes to these Terms">
        <p>We may update these Terms from time to time. Material changes will be notified by email or a prominent notice in the Service at least 14 days before they take effect. Continued use after the effective date constitutes acceptance.</p>
      </Section>

      <Section title="14. Contact">
        <p>
          {operator.name} · {operator.address}
          {email && <> · <a href={`mailto:${email}`} style={{ color: '#6f78e6' }}>{email}</a></>}
        </p>
      </Section>
    </div>
  )
}
