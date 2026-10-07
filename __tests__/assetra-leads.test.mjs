// AssetraDigital lead form: validation, spam traps and the notification e-mail.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { checkLead, leadEmailHtml, leadSubject, MIN_FILL_MS } = await import('../lib/assetra/lead.ts')

const ok = { jmeno: 'Jana Nováková, Pekárna Lipová', kontakt: 'jana@pekarna.cz', potreba: 'E-shop', zprava: 'Chceme e-shop.', web: '', ms: 9000 }

test('a normal lead passes and keeps the e-mail for Reply-To', () => {
  const r = checkLead(ok)
  assert.equal(r.ok, true)
  assert.equal(r.spam, false)
  assert.equal(r.contactEmail, 'jana@pekarna.cz')
  assert.deepEqual(r.lead, { jmeno: ok.jmeno, kontakt: ok.kontakt, potreba: 'E-shop', zprava: ok.zprava })
})

test('a phone number is a valid contact (no Reply-To)', () => {
  for (const kontakt of ['+420 777 123 456', '777123456', '(+420) 777-123-456']) {
    const r = checkLead({ ...ok, kontakt })
    assert.equal(r.ok && !r.spam, true, kontakt)
    assert.equal(r.contactEmail, null)
  }
})

test('missing or broken contact is rejected with a Czech message', () => {
  for (const kontakt of ['', '   ', 'jana', 'jana@', '12345', 'a'.repeat(200)]) {
    const r = checkLead({ ...ok, kontakt })
    assert.equal(r.ok, false, JSON.stringify(kontakt))
    assert.match(r.error, /[čěřšžýáíéůú]/)
  }
})

test('honeypot or a too-fast submit is treated as spam (fake success, nothing stored)', () => {
  assert.deepEqual(checkLead({ ...ok, web: 'https://spam.example' }), { ok: true, spam: true })
  assert.deepEqual(checkLead({ ...ok, ms: MIN_FILL_MS - 1 }), { ok: true, spam: true })
  assert.deepEqual(checkLead({ ...ok, ms: undefined }), { ok: true, spam: true })
  assert.deepEqual(checkLead(null), { ok: true, spam: true })
})

test('unknown "need" values are dropped, fields are trimmed and stripped of control chars', () => {
  const r = checkLead({ ...ok, potreba: 'Hack<script>', jmeno: ' Jana\r\nBcc: x@y.cz ', zprava: 'a\u0000b\r\nc' })
  assert.equal(r.ok && !r.spam, true)
  assert.equal(r.lead.potreba, '')
  assert.equal(r.lead.jmeno, 'Jana Bcc: x@y.cz')
  assert.equal(r.lead.zprava, 'a b\nc')
})

test('over-long message is rejected', () => {
  const r = checkLead({ ...ok, zprava: 'x'.repeat(4001) })
  assert.equal(r.ok, false)
})

test('notification escapes every field and says when the DB copy is missing', () => {
  const lead = { jmeno: '<img src=x onerror=alert(1)>', kontakt: 'a@b.cz', potreba: 'E-shop', zprava: '"quoted" & <b>' }
  const html = leadEmailHtml(lead, { id: null, stored: false, at: new Date('2026-10-07T10:00:00Z') })
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(html.includes('&quot;quoted&quot; &amp; &lt;b&gt;'))
  assert.match(html, /neuloženo v databázi/)
  const stored = leadEmailHtml(lead, { id: 'abc', stored: true, at: new Date() })
  assert.doesNotMatch(stored, /neuloženo/)
  assert.match(leadSubject(lead), /^Nová poptávka z webu: E-shop · /)
})
