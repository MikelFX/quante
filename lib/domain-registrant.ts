// Shared between server (lib/namecheap.ts, API routes) and client (the
// registrant contact form) — no Namecheap API calls or secrets here, so it's
// safe to import from 'use client' components. lib/namecheap.ts itself stays
// server-only and re-uses these same types/validation for defense in depth.

export interface DomainRegistrant {
  firstName: string
  lastName: string
  address1: string
  city: string
  stateProvince: string
  postalCode: string
  /** ISO 3166-1 alpha-2, e.g. "CZ", "US" */
  country: string
  /** Namecheap format: +CCC.NNNNNNNNNN, e.g. "+420.777123456" */
  phone: string
  email: string
}

export function emptyRegistrant(): DomainRegistrant {
  return {
    firstName: '', lastName: '', address1: '', city: '',
    stateProvince: '', postalCode: '', country: '', phone: '', email: '',
  }
}

// .eu registration is restricted by EU regulation to EU/EEA citizens,
// residents, and organisations established in the EU/EEA. Namecheap enforces
// this too, but we check up front so nobody gets charged via Stripe only to
// discover the registration was never going to succeed.
export const EU_EEA_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
])

export const PHONE_FORMAT = /^\+\d{1,3}\.\d{6,14}$/

/**
 * Validates registrant data. Returns a human-readable error string, or null
 * if the registrant is valid for the given domain. Used both client-side
 * (instant feedback in the form) and server-side (the actual gate — never
 * trust the client-side pass alone).
 */
export function validateRegistrant(registrant: DomainRegistrant, domain: string): string | null {
  const required: Array<[keyof DomainRegistrant, string]> = [
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['address1', 'Address'],
    ['city', 'City'],
    ['postalCode', 'Postal code'],
    ['country', 'Country'],
    ['phone', 'Phone'],
    ['email', 'Email'],
  ]
  for (const [key, label] of required) {
    if (!registrant[key] || !registrant[key].trim()) {
      return `${label} is required.`
    }
  }
  if (!PHONE_FORMAT.test(registrant.phone.trim())) {
    return 'Phone must be in the format +CountryCode.Number, e.g. +420.777123456.'
  }
  if (!/^[A-Z]{2}$/i.test(registrant.country.trim())) {
    return 'Country must be a 2-letter country code.'
  }
  const tld = domain.split('.').slice(1).join('.').toLowerCase()
  if (tld === 'eu' && !EU_EEA_COUNTRY_CODES.has(registrant.country.trim().toUpperCase())) {
    return '.eu domains can only be registered by an EU/EEA citizen, resident, or organisation. Choose a different TLD, or use an EU/EEA address.'
  }
  return null
}

// Reasonably complete country list for the registrant form — ISO alpha-2 +
// display name. Not exhaustive of all ~195 countries, but covers the EU/EEA
// (required for .eu eligibility) plus the other markets Quante is realistic
// to see customers from. Add more as needed; unknown codes still validate
// fine as long as they're 2 letters, this list is just for the <select>.
export const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'IS', name: 'Iceland' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'NO', name: 'Norway' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'JP', name: 'Japan' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'RS', name: 'Serbia' },
]
