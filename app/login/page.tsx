import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#070709', padding: '2rem 1rem',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* ambient glow */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 480, height: 320, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center,rgba(79,91,213,.22),transparent 70%)',
        filter: 'blur(40px)',
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        <Link href="/" style={{
          display: 'block', marginBottom: 28, textAlign: 'center',
          fontFamily: 'var(--font-geist-mono)', fontSize: 14, fontWeight: 600,
          color: '#f4f4f6', textDecoration: 'none', letterSpacing: '-.01em',
        }}>
          quante
        </Link>
        <SignIn routing="hash" />
      </div>
    </div>
  )
}
