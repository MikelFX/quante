// Plnolet — the service page (quantecode.com/plnolet until plnolet.cz gets its own host).
// Czech, for e-shops selling tobacco, e-cigarettes, nicotine pouches, alcohol or pyrotechnics.
// Prices only from lib/plnolet/pricing.ts.

import Link from 'next/link'
import type { Metadata } from 'next'
import { APP_ORIGIN } from '@/lib/domains'
import { PLNOLET_PAID, PLNOLET_PLANS, czk } from '@/lib/plnolet/pricing'
import { PnFoot, PnTop } from './_chrome'
import './plnolet.css'

export const metadata: Metadata = {
  title: 'Plnolet — ověření věku pro e-shopy',
  description:
    'Ověření věku 18+ a 21+ pro e-shopy s tabákem, e-cigaretami, nikotinovými sáčky a alkoholem. Bank iD, mojeID a věkový pas na jedno dotknutí. Obchod se dozví jen „ano, 18+“.',
  alternates: { canonical: `${APP_ORIGIN}/plnolet` },
}

const STEPS = [
  { t: 'Zákazník v košíku', d: 'U zboží 18+ pokladna otevře okno Plnolet. Stačí jedno volání API a malý skript.' },
  { t: 'Potvrdí věk', d: 'Přes Bank iD nebo mojeID. Kdo už má věkový pas, jen přiloží prst nebo se podívá do telefonu.' },
  { t: 'Obchod dostane „ano, 18+“', d: 'Nic víc. Žádné jméno, datum narození ani doklad. Do záznamu pro kontrolu jde čas a způsob ověření.' },
]

const WHY = [
  { t: 'Splní zákon u tabáku a nikotinu', d: 'Prodej na dálku smí jen se systémem, který věk ověří elektronicky a jednoznačně (§ 6 zákona č. 65/2017 Sb.). K oznámení ministerstvu dostanete hotový popis systému.' },
  { t: 'Vracející se zákazníci zdarma', d: 'Kdo se jednou ověří, dostane věkový pas na rok. Další nákupy na kterémkoli e-shopu s Plnolet už nepočítáme.' },
  { t: 'Záznamy pro ČOI a hygienu', d: 'Ke každé objednávce čas, metoda a výsledek. Export do CSV jedním klikem.' },
  { t: 'Soukromí na prvním místě', d: 'Údaje od banky přečteme jednou, spočítáme věk a zahodíme je. Ukládáme jen výsledek.' },
]

export default function PlnoletPage() {
  return (
    <div className="pn">
      <PnTop />
      <main className="pn-main">
        <section className="pn-hero">
          <p className="pn-eyebrow"><i aria-hidden="true" />Ověření věku pro e-shopy</p>
          <h1 className="pn-h1">Prodávejte 18+ <em>bez starostí</em> a bez otravování zákazníků.</h1>
          <p className="pn-lead">
            Plnolet ověří věk kupujícího přes Bank iD nebo mojeID a zapamatuje si ho ve věkovém pasu. Obchod se dozví jen
            „ano, je mu 18“. Pro tabák, e-cigarety, nikotinové sáčky, alkohol i pyrotechniku.
          </p>
          <div className="pn-ctas">
            <Link className="pn-btn pn-btn-pri" href="/plnolet/ucet">Vyzkoušet zdarma</Link>
            <a className="pn-btn pn-btn-sec" href="#api">Dokumentace API</a>
          </div>
        </section>

        <section className="pn-sec" id="jak">
          <h2 className="pn-h2">Jak to funguje</h2>
          <p>Tři kroky v pokladně. Zákazník neodchází z obchodu, okno se otevře nad košíkem.</p>
          <div className="pn-grid">
            {STEPS.map((s, i) => (
              <div className="pn-card" key={s.t}>
                <span className="pn-num">{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pn-sec">
          <h2 className="pn-h2">Proč Plnolet</h2>
          <p>„Je mi 18“ ani datum narození zákon u tabáku a nikotinu nepřijme. Plnolet ano, a zákazníka to zdrží jen poprvé.</p>
          <div className="pn-grid">
            {WHY.map((w) => (
              <div className="pn-card" key={w.t}>
                <h3>{w.t}</h3>
                <p>{w.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pn-sec" id="cenik">
          <h2 className="pn-h2">Ceník</h2>
          <p>
            Měsíční paušál s ověřeními v ceně. Počítáme jen nová ověření, zákazníci s věkovým pasem jsou zdarma.
            {!PLNOLET_PAID && ' Teď je k dispozici testovací režim zdarma; placené plány spustíme s ostrým provozem.'}
          </p>
          <div className="pn-scroll">
            <table className="pn-table">
              <thead>
                <tr><th scope="col">Plán</th><th scope="col">Měsíčně bez DPH</th><th scope="col">Nová ověření v ceně</th><th scope="col">Každé další</th><th scope="col">Pro koho</th></tr>
              </thead>
              <tbody>
                {PLNOLET_PLANS.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td>{czk(p.monthlyCzk)}</td>
                    <td>{p.included == null ? '–' : p.included}</td>
                    <td>{p.extraCzk == null ? '–' : czk(p.extraCzk)}</td>
                    <td>{p.forWhom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pn-note">Napojení na e-shopy postavené v Quante (přepínač v nastavení obchodu) připravujeme.</p>
        </section>

        <section className="pn-sec" id="api">
          <h2 className="pn-h2">API pro vývojáře</h2>
          <p>Klíč si vytvoříte v účtu. Testovací klíč (<code>plt_test_…</code>) funguje hned a nikoho doopravdy neověřuje.</p>
          <p className="pn-code-label">1. Na serveru otevřete ověření</p>
          <pre className="pn-code">{`curl ${APP_ORIGIN}/api/plnolet/v1/sessions \\
  -H "Authorization: Bearer plt_test_…" \\
  -H "Content-Type: application/json" \\
  -d '{"min_age": 18, "return_url": "https://vas-eshop.cz/pokladna", "reference": "obj-1042"}'

→ { "id": "ses_…", "url": "${APP_ORIGIN}/plnolet/v/ses_…", "status": "pending", … }`}</pre>
          <p className="pn-code-label">2. V prohlížeči otevřete okno</p>
          <pre className="pn-code">{`<script src="${APP_ORIGIN}/plnolet/widget.js" defer></script>
<script>
  const r = await Plnolet.verify(url)   // { session, status }
</script>`}</pre>
          <p className="pn-code-label">3. Na serveru si výsledek vždy ověřte</p>
          <pre className="pn-code">{`curl ${APP_ORIGIN}/api/plnolet/v1/sessions/ses_… \\
  -H "Authorization: Bearer plt_test_…"

→ { "status": "verified", "verified": true, "min_age": 18, "method": "bankid", "reference": "obj-1042", … }`}</pre>
          <p className="pn-note">
            Objednávku dokončete jen při <code>verified: true</code> z API, nikdy jen podle návratu prohlížeče.
            Odkaz platí 30 minut; <code>return_url</code> musí být na doméně, kterou máte v účtu.
          </p>
        </section>
      </main>
      <PnFoot />
    </div>
  )
}
