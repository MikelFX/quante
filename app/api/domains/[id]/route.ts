import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  // Verify ownership
  const { data: domain } = await supabase
    .from('user_domains')
    .select('id, domain')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!domain) return Response.json({ error: 'Not found' }, { status: 404 })

  // Soft delete — mark as expired
  await supabase
    .from('user_domains')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', id)

  return Response.json({ ok: true })
}
