import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS. Only use in server-side trusted contexts
// (webhooks, background jobs). Never expose to the client.
//
// SECURITY: this is a module-level singleton shared by every request on the
// lambda instance. Never call supabaseAdmin.auth.* session methods on it (e.g.
// exchangeCodeForSession / setSession / signIn*): a successful call would swap the
// shared client onto a user JWT for all later requests. persistSession and
// autoRefreshToken are disabled so no session can be stored or refreshed on it.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
)
