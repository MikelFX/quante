// validateRegistrant() — pure validation logic for domain purchase registrant
// contact data (required fields, phone format, .eu EU/EEA eligibility).
// Usage: node --test __tests__/domain-registrant.test.mjs
// Or via: npm run test:domain-registrant
//
// Inlined plain-JS copy of lib/domain-registrant.ts (must stay in sync) — same
// convention as __tests__/partner-commission.test.mjs / __tests__/store-health.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/domain-registrant.ts (inlined copy) ────────────────────────────────

function emptyRegistrant() {
  return {
    firstName: '', lastName: '', address1: '', city: '',
    stateProvince: '', postalCode: '', country: '', phone: '', email: '',
  }
}

const EU_EEA_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
])

const PHONE_FORMAT = /^\+\d{1,3}\.\d{6,14}$/

function validateRegistrant(registrant, domain) {
  const required = [
    ['firstName', 'First name'], ['lastName', 'Last name'], ['address1', 'Address'],
    ['city', 'City'], ['postalCode', 'Postal code'], ['country', 'Country'],
    ['phone', 'Phone'], ['email', 'Email'],
  ]
  for (const [key, label] of required) {
    if (!registrant[key] || !registrant[key].trim()) return `${label} is required.`
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

// ─── Tests ───────────────────────────────────────────────────────────────────

function validRegistrant(overrides = {}) {
  return {
    ...emptyRegistrant(),
    firstName: 'Jan', lastName: 'Novák', address1: 'Hlavní 1',
    city: 'Praha', postalCode: '11000', country: 'CZ',
    phone: '+420.777123456', email: 'jan@example.com',
    ...overrides,
  }
}

test('valid registrant + .com domain passes', () => {
  assert.equal(validateRegistrant(validRegistrant(), 'mystore.com'), null)
})

test('missing required field is rejected', () => {
  const r = validRegistrant({ address1: '' })
  assert.match(validateRegistrant(r, 'mystore.com'), /Address is required/)
})

test('all-whitespace field counts as missing', () => {
  const r = validRegistrant({ city: '   ' })
  assert.match(validateRegistrant(r, 'mystore.com'), /City is required/)
})

test('malformed phone is rejected', () => {
  const r = validRegistrant({ phone: '777123456' }) // missing +CC. prefix
  assert.match(validateRegistrant(r, 'mystore.com'), /Phone must be in the format/)
})

test('valid phone format with different country code passes', () => {
  const r = validRegistrant({ phone: '+1.4155551234' })
  assert.equal(validateRegistrant(r, 'mystore.com'), null)
})

test('non-2-letter country code is rejected', () => {
  const r = validRegistrant({ country: 'CZE' })
  assert.match(validateRegistrant(r, 'mystore.com'), /2-letter country code/)
})

test('.eu domain with EU/EEA registrant passes', () => {
  const r = validRegistrant({ country: 'DE' })
  assert.equal(validateRegistrant(r, 'mystore.eu'), null)
})

test('.eu domain with non-EU/EEA registrant is rejected', () => {
  const r = validRegistrant({ country: 'US' })
  assert.match(validateRegistrant(r, 'mystore.eu'), /EU\/EEA/)
})

test('.eu eligibility check is case-insensitive on country code', () => {
  const r = validRegistrant({ country: 'cz' })
  assert.equal(validateRegistrant(r, 'mystore.eu'), null)
})

test('non-.eu TLDs skip the EU/EEA check entirely', () => {
  const r = validRegistrant({ country: 'US' })
  assert.equal(validateRegistrant(r, 'mystore.io'), null)
  assert.equal(validateRegistrant(r, 'mystore.cz'), null)
})
