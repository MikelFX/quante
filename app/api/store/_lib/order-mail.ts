// Caps for the customer mails the store-key order API can trigger (shipped / refunded).
//
// SECURITY (re-audit R8): anyone can open a store and hold its QUANTE_API_KEY, and the
// order API mails order.customer_email — an address the caller chose at checkout. The
// status machine in ../orders/[orderId]/route.ts already makes each mail a one-time
// transition that needs a confirmed payment (or an offline order that went through the
// checkout's unpaid-order caps). On top of that every mail must win a slot here:
//   - per order    (in-memory, 2 / hour — defence in depth; the transitions allow 2 total)
//   - per project  (in-memory, 300 / hour per instance)
//   - per recipient across ALL stores (DB, atomic — reserve_order_mail_slot() from
//     supabase/migration-security3-store-api.sql, advisory lock on the lower-cased
//     address), so no set of stores / projects can mail one person more than
//     ORDER_MAIL_PER_RECIPIENT times an hour through this API.
// Until the migration has run (or if the RPC errors) the recipient cap falls back to an
// in-memory per-instance limit. A refused slot only suppresses the mail — the order's
// status change itself has already been made and stands.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

const HOUR = 60 * 60_000
export const ORDER_MAIL_PER_RECIPIENT = 10

export async function reserveOrderMailSlot(projectId: string, orderId: string, email: string): Promise<boolean> {
  const recipient = email.trim().toLowerCase()
  if (!recipient) return false
  if (!rateLimit(`store-order-mail:${orderId}`, 2, HOUR).allowed) return false
  if (!rateLimit(`store-order-mail-project:${projectId}`, 300, HOUR).allowed) return false

  const { data, error } = await supabaseAdmin.rpc('reserve_order_mail_slot', {
    p_project_id: projectId,
    p_order_id: orderId,
    p_email: recipient,
  })
  if (!error) return data === 'ok'
  console.error('[store/order-mail] reserve_order_mail_slot failed — using in-memory recipient cap (run migration-security3-store-api.sql):', error.message)
  return rateLimit(`store-order-mail-to:${recipient}`, ORDER_MAIL_PER_RECIPIENT, HOUR).allowed
}
