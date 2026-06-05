import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Link href="/new" className={cn(buttonVariants({ size: 'sm' }))}>
          New project
        </Link>
      </div>

      {(!projects || projects.length === 0) ? (
        <div className="border border-dashed border-border rounded-lg py-24 text-center">
          <p className="text-sm text-muted-foreground mb-4">No projects yet.</p>
          <Link href="/new" className={cn(buttonVariants({ size: 'sm' }))}>
            Build your first store
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((project: { id: string; name: string; status: string; updated_at: string }) => (
            <Link key={project.id} href={`/project/${project.id}`}>
              <Card className="px-4 py-3 hover:border-border/60 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(project.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs font-mono">
                    {project.status}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
