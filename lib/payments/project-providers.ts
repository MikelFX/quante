// Resolves payment providers for a project from the merchant's OWN credentials in
// project_secrets (encrypted at rest).
//
// SECURITY: there is deliberately NO fallback to Quante's platform gateway accounts
// (COMGATE_* / GOPAY_* / PAYPAL_* env vars). Falling back meant any store — or anyone
// calling /api/store/checkout with any projectId — could take payments into Quante's
// merchant account with no ledger record of whom the money belongs to. A gateway the
// merchant hasn't configured is simply unavailable (the resolvers return null).
//
// Test mode is OFF unless the merchant explicitly turned it on. When it is on, the
// notify routes never mark an order 'paid' (they record 'test_paid' instead).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { ComgateProvider } from './comgate'
import { GopayProvider } from './gopay'
import { PayPalProvider } from './paypal'

export interface ProjectPaymentCreds {
  comgateMerchantId: string | null
  comgateSecret: string | null
  gopayClientId: string | null
  gopayClientSecret: string | null
  gopayGoId: string | null
  paypalClientId: string | null
  paypalClientSecret: string | null
  testMode: boolean
}

export async function getProjectPaymentCreds(projectId: string): Promise<ProjectPaymentCreds> {
  const { data } = await supabaseAdmin
    .from('project_secrets')
    .select('comgate_merchant_id, comgate_secret, gopay_client_id, gopay_client_secret, gopay_go_id, paypal_client_id, paypal_client_secret, payment_test_mode')
    .eq('project_id', projectId)
    .maybeSingle()

  return {
    comgateMerchantId: (data?.comgate_merchant_id as string | null) ?? null,
    comgateSecret: decryptSecret(data?.comgate_secret as string | null),
    gopayClientId: (data?.gopay_client_id as string | null) ?? null,
    gopayClientSecret: decryptSecret(data?.gopay_client_secret as string | null),
    gopayGoId: (data?.gopay_go_id as string | null) ?? null,
    paypalClientId: (data?.paypal_client_id as string | null) ?? null,
    paypalClientSecret: decryptSecret(data?.paypal_client_secret as string | null),
    // Only an explicit `true` enables sandbox mode.
    testMode: data?.payment_test_mode === true,
  }
}

export function comgateForProject(creds: ProjectPaymentCreds): ComgateProvider | null {
  if (creds.comgateMerchantId && creds.comgateSecret) {
    return new ComgateProvider({ merchantId: creds.comgateMerchantId, secret: creds.comgateSecret, testMode: creds.testMode })
  }
  return null
}

export function gopayForProject(creds: ProjectPaymentCreds): GopayProvider | null {
  if (creds.gopayClientId && creds.gopayClientSecret && creds.gopayGoId) {
    return new GopayProvider({ clientId: creds.gopayClientId, clientSecret: creds.gopayClientSecret, goId: creds.gopayGoId, testMode: creds.testMode })
  }
  return null
}

export function paypalForProject(creds: ProjectPaymentCreds): PayPalProvider | null {
  if (creds.paypalClientId && creds.paypalClientSecret) {
    return new PayPalProvider({ clientId: creds.paypalClientId, clientSecret: creds.paypalClientSecret, testMode: creds.testMode })
  }
  return null
}

// The Comgate secret used to verify notifications — the project's own secret only.
export function comgateSecretForProject(creds: ProjectPaymentCreds): string | null {
  return creds.comgateSecret ?? null
}
