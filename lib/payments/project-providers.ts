// Resolves payment providers for a project: per-project merchant credentials
// from project_secrets (encrypted at rest) with platform env vars as fallback.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/crypto'
import { ComgateProvider, createComgateProvider } from './comgate'
import { GopayProvider, createGopayProvider } from './gopay'
import { PayPalProvider, createPayPalProvider } from './paypal'

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
    testMode: (data?.payment_test_mode as boolean | null) ?? true,
  }
}

export function comgateForProject(creds: ProjectPaymentCreds): ComgateProvider | null {
  if (creds.comgateMerchantId && creds.comgateSecret) {
    return new ComgateProvider({ merchantId: creds.comgateMerchantId, secret: creds.comgateSecret, testMode: creds.testMode })
  }
  return createComgateProvider()
}

export function gopayForProject(creds: ProjectPaymentCreds): GopayProvider | null {
  if (creds.gopayClientId && creds.gopayClientSecret && creds.gopayGoId) {
    return new GopayProvider({ clientId: creds.gopayClientId, clientSecret: creds.gopayClientSecret, goId: creds.gopayGoId, testMode: creds.testMode })
  }
  return createGopayProvider()
}

export function paypalForProject(creds: ProjectPaymentCreds): PayPalProvider | null {
  if (creds.paypalClientId && creds.paypalClientSecret) {
    return new PayPalProvider({ clientId: creds.paypalClientId, clientSecret: creds.paypalClientSecret, testMode: creds.testMode })
  }
  return createPayPalProvider()
}

// The Comgate HMAC secret used to verify webhook notifications — project secret
// first, platform env fallback.
export function comgateSecretForProject(creds: ProjectPaymentCreds): string | null {
  return creds.comgateSecret ?? process.env.COMGATE_SECRET ?? null
}
