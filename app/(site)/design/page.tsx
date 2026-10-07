import type { Metadata } from 'next'
import {
  BinaryStrip, Button, Card, CharHeading, CheckList, FloatingNav, GiantWordmark, InView, MotionToggle,
  ParticleZone, Pill, SectionLabel, SectionTitle, StackCards, Sub, Tapes, ThemeToggle, Timeline, delay,
} from '@ad/ui'
import { glass, ease, radii, tokenLabels, tokens, type TokenName } from '@ad/ui/tokens'
import { FormDemo, PricingDemo } from './DesignInteractive'
import s from './design.module.css'

export const metadata: Metadata = {
  title: 'Design systém',
  description: 'Tokeny, písma, komponenty a částice AssetraDigital naživo.',
  robots: { index: false, follow: false },
}

const NAV = [
  { href: '#tokeny', label: 'Tokeny', num: '01' },
  { href: '#komponenty', label: 'Komponenty', num: '02' },
  { href: '#bloky', label: 'Bloky', num: '03' },
  { href: '#castice', label: 'Částice', num: '04' },
]

const ZONES: { title: string; where: string; shapes: string[] }[] = [
  { title: 'Služby', where: 'Hlavní stránka, 01', shapes: ['WEB', 'E-SHOP', 'SPRÁVA'] },
  { title: 'Smlouva', where: 'Hlavní stránka, 02', shapes: ['§'] },
  { title: 'Ceník', where: 'Hlavní stránka, 03', shapes: ['0 Kč', '990', '2 490'] },
  { title: 'Postup', where: 'Hlavní stránka, 04', shapes: ['01', '02', '03', '04'] },
  { title: 'Ukázka práce', where: 'Hlavní stránka, 05', shapes: ['@wave', 'HARWO'] },
  { title: 'Quante', where: 'Hlavní stránka, 06', shapes: ['Q', 'ADS', 'AGENT'] },
  { title: 'Kontakt', where: 'Hlavní stránka, 07', shapes: ['@', 'AHOJ'] },
  { title: 'Rozcestník Quante', where: '/quante', shapes: ['Q', '@cube'] },
  { title: 'Quante Generate', where: '/quante/generate', shapes: ['GEN'] },
  { title: 'Qdit', where: '/quante/qdit', shapes: ['EDIT'] },
  { title: 'Qads', where: '/quante/qads', shapes: ['ADS'] },
  { title: 'Qails', where: '/quante/qails', shapes: ['@'] },
  { title: 'Qscan', where: '/quante/qscan', shapes: ['SCAN'] },
  { title: 'Qgent', where: '/quante/qgent', shapes: ['AGENT'] },
  { title: 'Patička', where: 'Všechny stránky', shapes: ['@logo', '@sphere'] },
]

function Swatches({ theme }: { theme: 'dark' | 'light' }) {
  const t = tokens[theme]
  return (
    <div className={s.theme} style={{ background: t.bg, color: t.fg }}>
      <h3>{theme === 'dark' ? 'Tmavý motiv · výchozí' : 'Světlý motiv'}</h3>
      <div className={s.swatches}>
        {(Object.keys(t) as TokenName[]).map((k) => (
          <div className={s.swatch} key={k}>
            <i style={{ background: t[k] }} />
            <b>{tokenLabels[k]}</b>
            <code style={{ color: theme === 'dark' ? tokens.dark.fg3 : tokens.light.fg3 }}>--{k}</code>
            <code style={{ color: theme === 'dark' ? tokens.dark.fg3 : tokens.light.fg3 }}>{t[k]}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DesignPage() {
  return (
    <>
      <FloatingNav links={NAV} cta={{ href: '#formular', label: 'Domluvit konzultaci' }} homeHref="#top" actions={<MotionToggle />} />
      <main>
        <InView className="hero" initial>
          <div className="hgrid" aria-hidden="true" />
          <div className="glow g1" aria-hidden="true" />
          <div className="glow g2" aria-hidden="true" />
          <div className="w hin">
            <div>
              <Pill badge="v2">design systém · web i aplikace Quante</Pill>
              <CharHeading text="Jeden design pro všechno" />
              <p className="lead rv" style={delay(0.55)}>
                Tokeny, písma, komponenty a částice AssetraDigital. Všechno na této stránce běží naživo, ve světlém
                i tmavém motivu a i s vypnutými animacemi.
              </p>
              <div className="ctas rv" style={delay(0.65)}>
                <Button href="#komponenty" variant="pri" beam arrow>Prohlédnout komponenty</Button>
                <Button href="#castice">Částice</Button>
              </div>
              <CheckList className="rv" delaySec={0.75} items={['Archivo, Geist a JetBrains Mono', 'Tmavý i světlý motiv', 'Funguje i bez animací']} />
            </div>
            <ParticleZone className="orb rv" style={delay(0.2)} shapes={['@logo', '@sphere', '@torus', '@cube']}>
              <span className="orb-l">Táhni nebo <b>klikni</b></span>
            </ParticleZone>
          </div>
        </InView>

        <InView className="sec" id="tokeny">
          <div className="w">
            <div className="sh2">
              <div>
                <SectionLabel num="01">Tokeny</SectionLabel>
                <SectionTitle>Barvy, sklo a písmo</SectionTitle>
                <Sub>Moduly nemají vlastní barvy. Odliší se tvarem částic, ikonou a obsahem.</Sub>
              </div>
            </div>
            <div className={s.themes}>
              <Swatches theme="dark" />
              <Swatches theme="light" />
            </div>
            <div className={s.specs}>
              <div className={`glass spot ${s.spec}`} style={{ borderRadius: radii.card }}><small>Karta</small><b>{radii.card} px</b><code>sklo · {glass.backdrop}</code></div>
              <div className={`glass spot ${s.spec}`} style={{ borderRadius: radii.card }}><small>Pilulka</small><b>{radii.pill} px</b><code>tlačítka, štítky, čipy</code></div>
              <div className={`glass spot ${s.spec}`} style={{ borderRadius: radii.card }}><small>Pole formuláře</small><b>{radii.field} px</b><code>focus: mint prstenec 4 px</code></div>
              <div className={`glass spot ${s.spec}`} style={{ borderRadius: radii.card }}><small>Easing všude</small><b>Out-expo</b><code>{ease}</code></div>
            </div>
            <div className={s.type}>
              <div>
                <span className="lbl">Archivo · nadpisy · verzálky, šířka 62–70 %, váha 850–900</span>
                <p className={s.display}>Web nebo e-shop</p>
              </div>
              <div>
                <span className="lbl">Geist · text</span>
                <p className="sub">Navrhneme a postavíme ho na míru. Vy platíte měsíční paušál, ve kterém je hosting, správa i drobné úpravy.</p>
              </div>
              <div>
                <span className="lbl">JetBrains Mono · štítky, kód a čísla</span>
                <p className={s.monoSample}>→ objednávka #2042 · 1 290 Kč · ✓ zaplaceno přes Comgate</p>
              </div>
            </div>
          </div>
        </InView>

        <InView className="sec" id="komponenty">
          <div className="w">
            <SectionLabel num="02">Komponenty</SectionLabel>
            <SectionTitle>Tlačítka, karty a formulář</SectionTitle>
            <Sub>Světlo běží po okraji, text se při najetí přeroluje a tlačítko jde za myší.</Sub>

            <div className={s.block}>
              <p className={s.blockTitle}>Tlačítka a přepínače</p>
              <div className={s.row}>
                <Button href="#formular" variant="pri" beam arrow>Domluvit konzultaci</Button>
                <Button href="#bloky">Prohlédnout ceník</Button>
                <Button href="#formular" variant="pri" arrow>Odeslat poptávku</Button>
                <ThemeToggle />
                <MotionToggle />
              </div>
              <div className={s.row}>
                <Pill badge="0 Kč">předem · weby a e-shopy na míru</Pill>
              </div>
              <CheckList items={['Vlastní kód bez šablon', 'České platby a doprava', 'Konzultace zdarma']} />
            </div>

            <div className="bento">
              <Card span={5} reveal delaySec={0.1}>
                <div className="ch"><h3>Firemní web</h3><span>01</span></div>
                <ul className="feat"><li><b>Rychlý</b></li><li>Funguje v mobilu</li><li>Vlastní design</li><li>Formulář</li><li>Základ SEO</li></ul>
              </Card>
              <Card span={7} reveal delaySec={0.2}>
                <div className="ch"><h3>Spotlight</h3><span>02</span></div>
                <p className="sub" style={{ marginTop: 0 }}>Skleněná karta: světlo se drží kurzoru a okraj má horní highlight.</p>
              </Card>
              <Card reveal delaySec={0.3}>
                <div className="ch"><h3>Celá šířka</h3><span>03</span></div>
                <ul className="feat"><li><b>Hosting</b></li><li>Zálohy</li><li>Aktualizace</li><li>Drobné úpravy</li></ul>
              </Card>
            </div>

            <div className={`ct ${s.block}`}>
              <div>
                <span className="lbl rv"><b>07</b>Kontakt</span>
                <h2 className="big ttl">Pojďme<span>to probrat</span></h2>
                <p className="sub rv" style={delay(0.15)}>Konzultace je zdarma. Ozveme se do <span className="todo">[doba]</span>.</p>
              </div>
              <FormDemo />
            </div>
          </div>
        </InView>

        <InView className="sec" id="bloky">
          <div className="w">
            <SectionLabel num="03">Bloky</SectionLabel>
            <SectionTitle>Pásy, smlouva a postup</SectionTitle>
          </div>
          <div className={s.block}>
            <BinaryStrip text="ASSETRA DIGITAL/WEB/E-SHOP/0 KC PREDEM/" />
            <Tapes
              label="Napojení: Comgate, Zásilkovna, PPL, Fakturoid"
              words={['Web', 'E-shop', 'Správa', '0 Kč předem', 'Vlastní kód']}
              items={[{ n: 'Comgate', d: 'platby' }, { n: 'Zásilkovna', d: 'výdejní místa' }, { n: 'PPL', d: 'doprava' }, { n: 'Fakturoid', d: 'faktury' }]}
            />
          </div>
          <div className="w">
            <div className={s.block}>
              <p className={s.blockTitle}>Karty, které se skládají na sebe</p>
              <StackCards
                items={[
                  { title: 'Doména patří vám', code: 'vlastník: vy' },
                  { title: 'Kód a data předáme', code: 'předání: kód + data' },
                  { title: 'Pevná cena a jasný rozsah', code: 'cena: pevná' },
                  { title: 'Platby jdou rovnou vám', code: 'platby → váš účet' },
                ]}
              />
            </div>
          </div>
        </InView>

        <InView className="sec">
          <div className="w">
            <PricingDemo />
          </div>
        </InView>

        <InView className="sec">
          <div className="w">
            <SectionLabel num="04">Postup</SectionLabel>
            <SectionTitle>Časová osa</SectionTitle>
            <Timeline
              steps={[
                { hash: 'a3f9c21', title: 'Konzultace', text: 'Zdarma. Probereme, co potřebujete a co dává smysl.' },
                { hash: '9c2f7d1', title: 'Nabídka a návrh', text: 'Pevná cena, jasný rozsah a návrh vzhledu.' },
                { hash: 'e07a3b5', title: 'Stavba', text: 'Postavíme web na míru ve vlastním kódu.' },
                { hash: 'f1d9c84', title: 'Spuštění a správa', text: 'Spustíme na vaší doméně a dál se o web staráme.' },
              ]}
            />
          </div>
        </InView>

        <InView className="sec" id="castice">
          <div className="w">
            <SectionLabel num="05">Částice</SectionLabel>
            <SectionTitle>Roj, který drží web pohromadě</SectionTitle>
            <Sub>
              Aktivní je zóna nejblíž středu obrazovky. Roj do ní přeletí a složí tvar, tvary se střídají po 4,8 s.
              Ťuknutí roj rozprskne do dalšího tvaru, tažení ho otáčí.
            </Sub>
            <div className={s.zones}>
              {ZONES.map((z) => (
                <div className={s.zoneRow} key={z.where}>
                  <div>
                    <h3>{z.title}</h3>
                    <p>{z.where}</p>
                    <code>{z.shapes.join(' · ')}</code>
                  </div>
                  <ParticleZone shapes={z.shapes} />
                </div>
              ))}
            </div>
          </div>
        </InView>
      </main>

      <InView as="footer" className="ft">
        <div className="w">
          <ParticleZone className="pz-f" shapes={['@logo', '@sphere']} />
        </div>
        <BinaryStrip text="HOSTING/ZALOHY/SPRAVA/VLASTNI KOD/" />
        <GiantWordmark />
        <div className={`w ${s.bar}`}>
          <span>© 2026 AssetraDigital s.r.o.</span>
          <div>
            <ThemeToggle />
            <MotionToggle />
            <a href="#top">Nahoru ↑</a>
          </div>
        </div>
      </InView>
    </>
  )
}
