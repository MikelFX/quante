import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'rgba(111,120,230,.2)',
  generating: 'rgba(251,189,59,.2)',
  ready: 'rgba(52,199,89,.2)',
}
const STATUS_DOT: Record<string, string> = {
  draft: '#6f78e6',
  generating: '#fbbf3b',
  ready: '#34c759',
}

async function ensureWelcomeGrant(userId: string, supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from('credit_ledger').select('id').eq('user_id', userId).limit(1).maybeSingle()
  if (!data) {
    await supabase.from('credit_ledger').insert({
      user_id: userId, delta: 25, reason: 'welcome_grant', ref_id: null, balance_after: 25,
    })
  }
}

export default async function DashboardPage() {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createClient()

  await ensureWelcomeGrant(userId, supabase)

  const { data: projects } = await supabase
    .from('projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false })

  return (
    <div style={{ padding: '1.5rem 1rem', maxWidth: 680, margin: '0 auto' }}>
      <style>{`
        .project-card {
          background: #0c0c10;
          border: 1px solid rgba(255,255,255,.07);
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .project-card:hover {
          border-color: rgba(255,255,255,.15);
          box-shadow: 0 0 0 1px rgba(111,120,230,.12);
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.02em' }}>Projects</h1>
        <Link href="/new" style={{
          fontSize: 12, fontWeight: 600, textDecoration: 'none',
          color: '#070709', background: '#f4f4f6',
          padding: '0.45rem 1rem', borderRadius: 7,
          letterSpacing: '-.005em',
        }}>
          + New project
        </Link>
      </div>

      {(!projects || projects.length === 0) ? (
        <div style={{
          border: '1px dashed rgba(255,255,255,.1)', borderRadius: 14,
          padding: '4rem 1.5rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: .4 }}>◻</div>
          <p style={{ fontSize: 14, color: 'var(--foreground)', fontWeight: 500, marginBottom: 6 }}>
            No projects yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 20, maxWidth: 280, margin: '0 auto 20px' }}>
            Describe a store and Quante builds it in seconds.
          </p>
          <Link href="/new" style={{
            fontSize: 13, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.6rem 1.4rem', borderRadius: 8, display: 'inline-block',
          }}>
            Build your first store
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {projects.map((project: { id: string; name: string; status: string; updated_at: string }) => (
            <Link key={project.id} href={`/project/${project.id}`} style={{ textDecoration: 'none' }}>
              <div className="project-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: STATUS_DOT[project.status] ?? '#6f78e6',
                    boxShadow: `0 0 6px ${STATUS_DOT[project.status] ?? '#6f78e6'}88`,
                  }} />
                  <p style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.name}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em',
                    padding: '2px 7px', borderRadius: 99,
                    background: STATUS_COLORS[project.status] ?? STATUS_COLORS.draft,
                    color: STATUS_DOT[project.status] ?? '#6f78e6',
                  }}>
                    {project.status}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'var(--font-geist-mono)' }}>
                    {timeAgo(project.updated_at)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
