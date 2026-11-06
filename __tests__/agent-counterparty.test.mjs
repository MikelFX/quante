// Counterparty check for agents (owner 2026-11-06: "a tool nobody has"): bank accounts in every Czech
// form become one IBAN, the VAT-payer register's SOAP answer is read without an XML library, and the
// verdict names each risk with its register — never a guess. lib/agents/counterparty.ts is pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const ROOT = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(specifier + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
})

const CP = await import('../lib/agents/counterparty.ts')
const CO = await import('../lib/agents/company.ts')
const PR = await import('../lib/agents/paid-price.ts')
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')

// The register's real answer shape (2026-11-06), shortened.
const SOAP = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body><StatusNespolehlivyPlatceResponse xmlns="http://adis.mfcr.cz/rozhraniCRPDPH/"><status odpovedGenerovana="2026-11-06" statusCode="0" statusText="OK"/><statusPlatceDPH dic="CZ45274649" nespolehlivyPlatce="NE" cisloFu="13"><zverejneneUcty><ucet datumZverejneni="2013-04-01"><standardniUcet cislo="71504011" kodBanky="0100"/></ucet><ucet datumZverejneni="2013-04-01"><nestandardniUcet cislo="CZ6426000000002001268200"/></ucet><ucet datumZverejneni="2013-04-01"><standardniUcet predcisli="27" cislo="5868650297" kodBanky="0100"/></ucet></zverejneneUcty></statusPlatceDPH><statusPlatceDPH dic="CZ12345678" nespolehlivyPlatce="ANO" datumZverejneniNespolehlivosti="2024-03-15" cisloFu="451"><zverejneneUcty/></statusPlatceDPH><statusPlatceDPH dic="CZ99999999" nespolehlivyPlatce="NENALEZEN"/></StatusNespolehlivyPlatceResponse></soapenv:Body></soapenv:Envelope>`

test('Czech bank accounts in every form become one IBAN with valid check digits', () => {
  const a = CP.parseBankAccount('19-2000145399/0800')
  assert.equal(a.iban, 'CZ6508000000192000145399')
  assert.equal(a.local, '19-2000145399/0800')
  assert.equal(CP.parseBankAccount('2000145399/0800').iban, 'CZ' + CP.czIban('', '2000145399', '0800').slice(2))
  assert.equal(CP.parseBankAccount('cz65 0800 0000 1920 0014 5399').iban, 'CZ6508000000192000145399')
  assert.equal(CP.parseBankAccount('CZ6508000000192000145399').local, '19-2000145399/0800')
  assert.equal(CP.parseBankAccount('DE89370400440532013000').country, 'DE')
  assert.equal(CP.parseBankAccount('CZ6508000000192000145398'), null) // wrong check digits
  assert.equal(CP.parseBankAccount('abc'), null)
  assert.equal(CP.parseBankAccount(''), null)
  assert.ok(CP.isValidIban('GB82WEST12345698765432'))
  assert.ok(!CP.isValidIban('GB82WEST12345698765433'))
})

test('the query: ico / vat rules of the company check, account optional and validated', () => {
  const q = CP.parseCounterpartyQuery({ vat: 'CZ27082440', account: ' 2000145399/0800 ' })
  assert.equal(q.ico, '27082440')
  assert.equal(q.account.local, '2000145399/0800')
  assert.equal(CP.parseCounterpartyQuery({ ico: '27082440' }).account, null)
  assert.throws(() => CP.parseCounterpartyQuery({ ico: '27082440', account: '12/34' }), CO.CompanyInputError)
  assert.throws(() => CP.parseCounterpartyQuery({ account: '2000145399/0800' }), CO.CompanyInputError) // a company is needed
})

test('the VAT-payer register answer: status, since when, published accounts as IBANs', () => {
  const xml = CP.vatPayerRequestXml(['CZ45274649', 'CZ<x>'])
  assert.ok(xml.includes('<roz:dic>CZ45274649</roz:dic>') && xml.includes('<roz:dic>CZx</roz:dic>'))
  const list = CP.parseVatPayerStatus(SOAP)
  assert.equal(list.length, 3)
  const [ok, bad, none] = list
  assert.equal(ok.status, 'reliable')
  assert.equal(ok.taxOffice, '13')
  assert.deepEqual(ok.accounts.map((a) => a.local), ['71504011/0100', '2001268200/2600', '27-5868650297/0100'])
  assert.equal(ok.accounts[1].iban, 'CZ6426000000002001268200')
  assert.equal(ok.accounts[0].published, '2013-04-01')
  assert.equal(bad.status, 'unreliable')
  assert.equal(bad.unreliableSince, '2024-03-15')
  assert.deepEqual(bad.accounts, [])
  assert.equal(none.status, 'not_found')
  assert.equal(CP.parseVatPayerStatus('<html>maintenance</html>'), null)
  assert.equal(CP.parseVatPayerStatus(SOAP.replace('statusCode="0"', 'statusCode="2"')), null)
})

test('ARES: liquidation from the name, insolvency record from the register list', () => {
  const base = { ico: '26863154', obchodniJmeno: 'OKD, a.s. v likvidaci', seznamRegistraci: { stavZdrojeIr: 'AKTIVNI', stavZdrojeDph: 'AKTIVNI' } }
  const c = CO.aresCompany(base)
  assert.equal(c.inLiquidation, true)
  assert.equal(c.insolvencyRecord, true)
  const d = CO.aresCompany({ ico: '27082440', obchodniJmeno: 'Alza.cz a.s.', seznamRegistraci: { stavZdrojeIr: 'NEEXISTUJICI' } })
  assert.equal(d.inLiquidation, false)
  assert.equal(d.insolvencyRecord, false)
  assert.equal(CO.aresCompany({ ico: '1', obchodniJmeno: 'X' }).insolvencyRecord, null)
})

test('the verdict names every risk with its register; safe only when nothing speaks against it', () => {
  const now = new Date('2026-11-06T10:00:00Z')
  const good = { ico: '45274649', name: 'ČEZ, a. s.', vatId: 'CZ45274649', vatRegistered: true, founded: '1992-05-06', dissolved: null, active: true, inLiquidation: false, insolvencyRecord: false, legalForm: null, legalFormCode: null, address: null, country: 'CZ', activities: [] }
  const payer = CP.parseVatPayerStatus(SOAP)[0]
  const q = CP.parseCounterpartyQuery({ ico: '45274649', account: '71504011/0100' })
  const v = CP.counterpartyVerdict({ query: q, ares: good, vies: { vatNumber: 'CZ45274649', valid: true, name: null, address: null, checkedAt: null, note: null }, vatPayer: payer, now })
  assert.equal(v.safeToPay, true)
  assert.deepEqual(v.risks, [])
  assert.equal(v.account.published, true)
  assert.equal(v.account.publishedSince, '2013-04-01')
  assert.ok(v.links.ares.includes('45274649') && v.links.insolvencyRegister.includes('45274649') && v.links.vatPayerRegister.includes('45274649'))

  // an unpublished account → high risk, not safe
  const q2 = CP.parseCounterpartyQuery({ ico: '45274649', account: '123456789/0100' })
  const v2 = CP.counterpartyVerdict({ query: q2, ares: good, vies: undefined, vatPayer: payer, now })
  assert.equal(v2.safeToPay, false)
  assert.equal(v2.account.published, false)
  assert.deepEqual(v2.risks.map((r) => [r.code, r.severity, r.source]), [['account_not_published', 'high', 'Finanční správa']])

  // unreliable payer + liquidation + insolvency + young + VIES invalid
  const risky = { ...good, name: 'Firma s.r.o. v likvidaci', inLiquidation: true, insolvencyRecord: true, founded: '2026-08-01' }
  const v3 = CP.counterpartyVerdict({ query: CP.parseCounterpartyQuery({ ico: '45274649' }), ares: risky, vies: { vatNumber: 'CZ45274649', valid: false, name: null, address: null, checkedAt: null, note: null }, vatPayer: CP.parseVatPayerStatus(SOAP)[1], now })
  assert.equal(v3.safeToPay, false)
  assert.deepEqual(v3.risks.map((r) => r.code).sort(), ['insolvency_record', 'liquidation', 'unreliable_vat_payer', 'vat_invalid', 'young_company'])
  assert.ok(v3.risks.find((r) => r.code === 'unreliable_vat_payer').text.includes('2024-03-15'))

  // not found / unreachable
  assert.equal(CP.counterpartyVerdict({ query: CP.parseCounterpartyQuery({ ico: '45274649' }), ares: false, vies: undefined, vatPayer: undefined, now }).safeToPay, false)
  const unknown = CP.counterpartyVerdict({ query: CP.parseCounterpartyQuery({ ico: '45274649' }), ares: null, vies: undefined, vatPayer: null, now })
  assert.equal(unknown.safeToPay, null)
  assert.ok(unknown.risks.every((r) => r.severity === 'info'))

  // a foreign VAT number alone: VIES only, said so, never "safe"
  const de = CP.counterpartyVerdict({ query: CP.parseCounterpartyQuery({ vat: 'DE811569869' }), ares: undefined, vies: { vatNumber: 'DE811569869', valid: true, name: null, address: null, checkedAt: null, note: null }, vatPayer: undefined, now })
  assert.equal(de.safeToPay, null)
  assert.deepEqual(de.risks.map((r) => r.code), ['only_vies'])

  // not a VAT payer: the account cannot be compared, said as info, still safe
  const nonPayer = { ...good, vatId: null, vatRegistered: false }
  const v4 = CP.counterpartyVerdict({ query: q, ares: nonPayer, vies: undefined, vatPayer: undefined, now })
  assert.equal(v4.safeToPay, true)
  assert.equal(v4.account.published, null)
  assert.deepEqual(v4.risks.map((r) => r.code), ['not_vat_payer', 'account_check_not_applicable'])
})

test('the tool is priced, listed and wired: price, pay-per-call list, MCP, OpenAPI, fixed hosts only', () => {
  assert.equal(PR.AGENT_TOOL_FIXED_USD.counterparty, 0.03)
  assert.ok(PR.PAY_PER_CALL_TOOLS.includes('counterparty'))
  const tools = read('lib/agents/agent-tools.ts')
  assert.ok(tools.includes("tool: 'counterparty'") && tools.includes("'verify_counterparty'"))
  assert.ok(tools.includes('VAT_PAYER_SERVICE') && !/fetch\(`?https?:\/\/\$\{/.test(tools), 'registers are fixed hosts, never built from input')
  assert.ok(tools.includes("failed(503, 'The registers are not answering right now. Nothing was charged"), 'unreachable registers are not charged')
  assert.ok(read('app/api/agent/v1/counterparty/route.ts').includes('paidToolResponse(req, COUNTERPARTY_HTTP_TOOL'))
  assert.ok(read('app/api/mcp/route.ts').includes("name === 'verify_counterparty'"))
  assert.ok(read('docs/agents/listing.md').includes('`verify_counterparty`'))
})
