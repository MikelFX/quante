import { auth, currentUser } from '@clerk/nextjs/server'
import { SignOutButton } from '@clerk/nextjs'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const metadata = { title: 'Settings — Quante' }

export default async function SettingsPage() {
  const { userId } = await auth()
  if (!userId) return null

  const [user, supabase] = await Promise.all([currentUser(), createClient()])

  const { data: ledger } = await supabase
    .from('credit_ledger').select('balance_after')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const balance = ledger?.balance_after ?? 0
  const email = user?.emailAddresses[0]?.emailAddress ?? '—'
  const createdAt = user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  return (
    <div style={{ padding: '1.5rem 1rem', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em', marginBottom: '1.5rem' }}>Settings</h1>

      {/* Account */}
      <div style={{ background: '#0c0c10', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
          <p style={{ fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Account</p>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 3 }}>Email</p>
            <p style={{ fontSize: 13, fontFamily: 'var(--font-geist-mono)' }}>{email}</p>
          </div>
          <div>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 3 }}>User ID</p>
            <p style={{ fontSize: 11, fontFamily: 'var(--font-geist-mono)', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userId}</p>
          </div>
          <div>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 3 }}>Member since</p>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{createdAt}</p>
          </div>
        </div>
      </div>

      {/* Credits */}
      <div style={{ background: '#0c0c10', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
          <p style={{ fontSize: 10, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Credits</p>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', letterSpacing: '-.03em', lineHeight: 1 }}>{balance}</p>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>credits remaining</p>
          </div>
          <Link href="/billing" style={{
            fontSize: 12, textDecoration: 'none',
            padding: '6px 14px', borderRadius: 7,
            border: '1px solid rgba(255,255,255,.1)',
            color: 'var(--muted-foreground)',
          }}>
            Buy credits
          </Link>
        </div>
      </div>

      {/* Sign out */}
      <div style={{ background: '#0c0c10', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Sign out</p>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 3 }}>Sign out of your account</p>
          </div>
          <SignOutButton redirectUrl="/login">
            <button style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,.1)', background: 'none',
              color: 'var(--muted-foreground)',
            }}>
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ background: '#0c0c10', border: '1px solid rgba(220,60,60,.2)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Delete account</p>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 3 }}>Permanently remove all data. Cannot be undone.</p>
          </div>
          <button disabled style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 7, cursor: 'not-allowed',
            border: '1px solid rgba(220,60,60,.25)', background: 'none',
            color: 'rgba(248,113,113,.5)',
          }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
