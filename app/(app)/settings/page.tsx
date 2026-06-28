import { auth, currentUser } from '@clerk/nextjs/server'
import { SignOutButton } from '@clerk/nextjs'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const metadata = { title: 'Settings — Quante' }

const cardSt: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,.07)',
  background: '#0c0c10',
  boxShadow: '0 0 0 1px rgba(255,255,255,.06), 0 4px 20px rgba(0,0,0,.3)',
  overflow: 'hidden',
}

const cardHeaderSt: React.CSSProperties = {
  padding: '10px 18px',
  borderBottom: '1px solid rgba(255,255,255,.06)',
  fontSize: 10,
  fontFamily: 'var(--font-geist-mono)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.07em',
  color: '#5b5b64',
}

const rowSt: React.CSSProperties = {
  padding: '14px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

export default async function SettingsPage() {
  const { userId } = await auth()
  if (!userId) return null

  const [user, supabase] = await Promise.all([currentUser(), createClient()])

  const { data: ledger } = await supabase
    .from('credit_ledger').select('balance_after')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const balance = ledger?.balance_after ?? 0
  const email = user?.emailAddresses[0]?.emailAddress ?? '—'
  const createdAt = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return (
    <div style={{ padding: '2rem 1.5rem 3rem', maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#5b5b64', margin: '0 0 8px' }}>account</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', color: '#f4f4f6', margin: '0 0 4px' }}>Settings</h1>
        <p style={{ fontSize: 13, color: '#8a8a93', margin: 0 }}>Manage your account and preferences.</p>
      </div>

      {/* Account */}
      <div style={cardSt}>
        <p style={cardHeaderSt}>Account</p>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Email</p>
            <p style={{ fontSize: 14, fontFamily: 'var(--font-geist-mono)', color: '#f4f4f6', margin: 0, fontWeight: 500 }}>{email}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>User ID</p>
            <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{userId}</p>
          </div>
          <div>
            <p style={{ fontSize: 10, fontFamily: 'var(--font-geist-mono)', color: '#5b5b64', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Member since</p>
            <p style={{ fontSize: 13, color: '#8a8a93', margin: 0 }}>{createdAt}</p>
          </div>
        </div>
      </div>

      {/* Credits */}
      <div style={cardSt}>
        <p style={cardHeaderSt}>Credits</p>
        <div style={rowSt}>
          <div>
            <p style={{ fontSize: 48, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-.04em', color: '#f4f4f6', lineHeight: 1, margin: '0 0 4px', textShadow: '0 0 40px rgba(111,120,230,.4)' }}>{balance}</p>
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>credits remaining</p>
            {balance < 10 && (
              <p style={{ fontSize: 11, color: '#e0a04f', marginTop: 5 }}>Low balance</p>
            )}
          </div>
          <Link
            href="/billing"
            style={{
              fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8,
              border: '1px solid rgba(111,120,230,.3)', background: 'rgba(111,120,230,.08)',
              color: '#6f78e6', textDecoration: 'none', flexShrink: 0,
              transition: 'background 0.12s',
            }}
          >
            Buy credits →
          </Link>
        </div>
      </div>

      {/* Sign out */}
      <div style={cardSt}>
        <div style={rowSt}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#f4f4f6', margin: '0 0 3px' }}>Sign out</p>
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Sign out of your Quante account</p>
          </div>
          <SignOutButton redirectUrl="/login">
            <button style={{
              fontSize: 12, fontWeight: 500, padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,.09)', background: 'transparent',
              color: '#8a8a93', flexShrink: 0,
            }}>
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ ...cardSt, border: '1px solid rgba(224,86,79,.18)' }}>
        <p style={{ ...cardHeaderSt, color: 'rgba(224,86,79,.6)' }}>Danger zone</p>
        <div style={rowSt}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#f4f4f6', margin: '0 0 3px' }}>Delete account</p>
            <p style={{ fontSize: 12, color: '#8a8a93', margin: 0 }}>Permanently removes all projects, manifests, and data. Cannot be undone.</p>
          </div>
          <button
            disabled
            title="Contact support to delete your account"
            style={{
              fontSize: 12, fontWeight: 500, padding: '7px 16px', borderRadius: 8,
              border: '1px solid rgba(224,86,79,.25)', background: 'transparent',
              color: 'rgba(224,86,79,.45)', cursor: 'not-allowed', flexShrink: 0,
            }}
          >
            Delete
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#5b5b64', padding: '0 18px 14px', margin: 0 }}>
          To delete your account, contact <a href="mailto:support@quante.app" style={{ color: '#6f78e6', textDecoration: 'none' }}>support@quante.app</a>.
        </p>
      </div>

    </div>
  )
}
