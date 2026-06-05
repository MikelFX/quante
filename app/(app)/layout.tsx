import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Separator } from '@/components/ui/separator'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-border">
          <Link href="/dashboard" className="font-mono text-sm font-semibold">
            quante
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          <NavLink href="/dashboard">Projects</NavLink>
          <NavLink href="/new">New project</NavLink>
          <Separator className="my-2" />
          <NavLink href="/billing">Billing</NavLink>
          <NavLink href="/settings">Settings</NavLink>
        </nav>

        <div className="px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button
              type="submit"
              className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded px-2 py-1.5 transition-colors"
    >
      {children}
    </Link>
  )
}
