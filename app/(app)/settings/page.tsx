import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const metadata = { title: 'Settings — Quante' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: ledger } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = ledger?.balance_after ?? 0

  return (
    <div className="px-8 py-8 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Account */}
      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        <div className="px-5 py-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Account</p>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Email</p>
              <p className="text-sm font-mono">{user?.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">User ID</p>
              <p className="text-xs font-mono text-muted-foreground">{user?.id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Account created</p>
              <p className="text-sm text-muted-foreground">
                {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric',
                }) : '—'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Credits</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold font-mono">{balance}</p>
              <p className="text-xs text-muted-foreground mt-0.5">credits remaining</p>
            </div>
            <Link
              href="/billing"
              className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Buy credits
            </Link>
          </div>
        </div>
      </div>

      {/* Authentication */}
      <div className="rounded-lg border border-border px-5 py-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Authentication</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sign out of all devices</p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-lg border border-destructive/30 px-5 py-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Danger zone</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently delete your account and all projects. This cannot be undone.
            </p>
          </div>
          <button
            disabled
            title="Contact support to delete your account"
            className="text-xs px-3 py-1.5 rounded border border-destructive/30 text-destructive/60 cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
