import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS. Only use in server-side trusted contexts
// (webhooks, background jobs). Never expose to the client.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder'
)
