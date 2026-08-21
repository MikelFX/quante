// Business/payments/shipping settings for code-gen mode stores — market-neutral,
// stored on project_secrets (merchant_json/payments_json/shipping_json), independent
// of the legacy Czech-specific ShopManifest/Merchant model in types/manifest.ts.
// See supabase/migration-business-info.sql for the DB side.

export interface BusinessInfo {
  name: string
  taxId: string // company/registration number (IČO for CZ, EIN/company number elsewhere)
  vatId: string // VAT number, if applicable
  vatRegistered: boolean
  country: string // ISO 3166-1 alpha-2, e.g. 'CZ', 'US', '' if unset
  street: string
  city: string
  postalCode: string
  email: string
  phone: string
  bankAccount: string
  responsiblePerson: string
}

export const EMPTY_BUSINESS_INFO: BusinessInfo = {
  name: '',
  taxId: '',
  vatId: '',
  vatRegistered: false,
  country: '',
  street: '',
  city: '',
  postalCode: '',
  email: '',
  phone: '',
  bankAccount: '',
  responsiblePerson: '',
}

export interface PaymentsInfo {
  providers: Array<'comgate' | 'gopay'>
  cod: { enabled: boolean; fee: number }
  bankTransfer: { enabled: boolean; qr: boolean }
}

export const EMPTY_PAYMENTS_INFO: PaymentsInfo = {
  providers: [],
  cod: { enabled: false, fee: 0 },
  bankTransfer: { enabled: true, qr: true },
}

export interface ShippingMethodEntry {
  id: string // 'zasilkovna' | 'ppl' | 'dpd' | 'balikovna' | 'custom-<n>'
  label: string
  price: number
}

export interface ShippingInfo {
  methods: ShippingMethodEntry[]
  pickupEnabled: boolean
  freeShippingFrom: number
}

export const EMPTY_SHIPPING_INFO: ShippingInfo = {
  methods: [],
  pickupEnabled: false,
  freeShippingFrom: 0,
}
