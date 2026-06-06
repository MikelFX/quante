import { supabaseAdmin } from './admin'

// All server-side DB operations use the service-role client.
// Clerk handles authentication; we filter by userId explicitly in every query.
export async function createClient() {
  return supabaseAdmin
}
