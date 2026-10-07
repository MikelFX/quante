'use client'

import { useEffect, useState } from 'react'
import { useMotionAllowed } from '@ad/ui'

// The hero's sample shop: a browser with a coffee e-shop, a phone with today's orders and a
// "paid" notification. Every 3.6 s a new order arrives (design: renderVals() tick).

const NAMES = ['Jana N.', 'Tomáš K.', 'Petra V.', 'Martin H.', 'Eva S.', 'Lukáš B.']
const AMOUNTS = [1290, 658, 2180, 947, 1590, 329]
const STATES: [string, string][] = [['Zaplaceno', 'o-s ok'], ['Zabaleno', 'o-s'], ['Odesláno', 'o-s'], ['Doručeno', 'o-s']]
const BAGS = [
  { n: 'Etiopie Guji', pr: '329 Kč', c: '#b4532a' },
  { n: 'Kolumbie Huila', pr: '299 Kč', c: '#5f7d5c' },
  { n: 'Keňa AA', pr: '359 Kč', c: '#2f3d5e' },
  { n: 'Brazílie Cerrado', pr: '279 Kč', c: '#c19a5b' },
]

// Same output on the server and in every browser (no locale data involved): 18 420 Kč.
const kc = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Kč'

export function HeroStage() {
  const [t, setT] = useState(0)
  const motion = useMotionAllowed()

  useEffect(() => {
    if (!motion) return
    const id = window.setInterval(() => {
      if (!document.hidden) setT((x) => x + 1)
    }, 3600)
    return () => window.clearInterval(id)
  }, [motion])

  const par = t % 2 ? 'a' : 'b'
  let total = 18420
  for (let i = 1; i <= Math.min(t, 400); i++) total += AMOUNTS[(2041 + i) % 6]
  const latest = 2041 + t

  return (
    <div className="stagew w">
      <div className="tilt">
        <div className="dev" aria-hidden="true">
          <div className="br">
            <div className="bt"><i /><i /><i /><span className="url">vas-eshop.cz</span></div>
            <div className="sh">
              <div className="sh-h">
                <span className="sh-logo">zrno.</span>
                <span className="sh-nav"><span>Káva</span><span>Příslušenství</span><span>O nás</span></span>
                <span className="cart">Košík<b>{2 + (t % 3)}</b></span>
              </div>
              <div className="sh-hero"><b>Výběrová káva z malé pražírny</b><span>Nakupovat</span></div>
              <div className="sh-g">
                {BAGS.map((p) => (
                  <div className="pt" key={p.n}>
                    <div className="tile"><div className="bag" style={{ backgroundColor: p.c }} /></div>
                    <b>{p.n}</b>
                    <span>{p.pr}</span>
                    <span className="add">Do košíku</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="ph">
            <div className="ph-s">
              <div className="ph-t">Objednávky<small>dnes</small></div>
              <div className="ph-k"><small>Tržby dnes</small><b>{kc(total)}</b></div>
              {STATES.map(([st, sc], r) => {
                const no = 2041 + t - r
                return (
                  <div className={r === 0 ? 'row n' + par : 'row'} key={no}>
                    <span className="o-n">#{no}</span>
                    <span>{NAMES[no % 6]}</span>
                    <span className="o-a">{kc(AMOUNTS[no % 6])}</span>
                    <span className={sc}>{st}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className={'toast t' + par}>
            <i>✓</i>
            <div><b>Objednávka #{latest} zaplacena</b><small>{kc(AMOUNTS[latest % 6])} · Comgate</small></div>
          </div>
          <div className="fc f1 glass"><i /><div>Comgate<small>platba přijata</small></div></div>
          <div className="fc f2 glass"><i /><div>Zásilkovna<small>štítek vytvořen</small></div></div>
          <div className="fc f3 glass"><i /><div>Fakturoid<small>faktura vystavena</small></div></div>
        </div>
      </div>
    </div>
  )
}
