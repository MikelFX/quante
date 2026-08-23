import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'
import { ShelfBackground } from '@/components/public/ShelfBackground'

// Same scoped light override as app/login/page.tsx — see that file's
// comment for why this doesn't touch the root ClerkProvider appearance.
const clerkAppearance = {
  variables: {
    colorBackground: '#FFFFFF',
    colorText: '#1B1A22',
    colorPrimary: '#5B54F0',
    colorInputBackground: '#FAF7F1',
    colorInputText: '#1B1A22',
    colorNeutral: '#57545F',
    colorDanger: '#D6534A',
    borderRadius: '14px',
    fontFamily: 'var(--font-geist-sans)',
    fontFamilyButtons: 'var(--font-geist-sans)',
  },
  elements: {
    card: {
      background: 'rgba(255,255,255,.72)',
      backdropFilter: 'blur(20px) saturate(160%)',
      border: '1px solid rgba(255,255,255,.75)',
      boxShadow: '0 10px 34px -12px rgba(27,26,34,.16)',
      borderRadius: '20px',
    },
    headerTitle: { color: '#1B1A22', fontWeight: '700' },
    headerSubtitle: { color: '#57545F' },
    socialButtonsBlockButton: {
      background: 'rgba(27,26,34,.04)',
      border: '1px solid rgba(27,26,34,.09)',
      color: '#1B1A22',
    },
    formFieldInput: {
      background: '#FAF7F1',
      border: '1px solid rgba(27,26,34,.09)',
      color: '#1B1A22',
    },
    footerActionLink: { color: '#5B54F0' },
    identityPreviewText: { color: '#57545F' },
    formButtonPrimary: { background: '#5B54F0', color: '#fff' },
    dividerLine: { background: 'rgba(27,26,34,.08)' },
    dividerText: { color: '#8C8996' },
  },
}

export default function SignUpPage() {
  return (
    <div className="qnt-public" style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1rem', position: 'relative', overflow: 'hidden',
    }}>
      <ShelfBackground variant="a" />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        <Link href="/" style={{
          display: 'block', marginBottom: 28, textAlign: 'center',
          fontFamily: 'var(--qp-mono)', fontSize: 14, fontWeight: 600,
          color: 'var(--qp-ink)', textDecoration: 'none', letterSpacing: '-.01em',
        }}>
          quante
        </Link>
        <SignUp routing="hash" appearance={clerkAppearance} />
      </div>
    </div>
  )
}
