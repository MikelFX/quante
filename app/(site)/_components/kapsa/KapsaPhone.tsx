import type { CSSProperties, ReactNode } from 'react'
import { cx } from '@ad/ui'
import { kapsa } from '@/content/assetra/kapsa'

// Kapsa's screens drawn in HTML inside the Branka phone frame (.br-ph, site.css), for the homepage
// showcase. Not screenshots: every screen shows a feature from content/assetra/kapsa.ts with one
// consistent example (kapsa.showcase). Styles kapsa-phone.css (.ad .kp-*, keyframes ad-kp-*), sized
// in container units so a 150 px phone and a 240 px phone look the same. Screen readers get one
// label per phone; the drawn UI is aria-hidden.

const s = kapsa.showcase

export type KapsaScreen = 'today' | 'debts' | 'coach' | 'salary' | 'afford' | 'remind' | 'insight'

const LABELS: Record<KapsaScreen, string> = {
  today: `Kapsa, obrazovka Dnes: ${s.today.limitLabel} ${s.today.limit}, ${s.today.days} dní do výplaty, otázka „${s.today.ask}“ a karta ${s.today.next.label}: ${s.today.next.title}.`,
  debts: `Kapsa, plán splácení dluhů metodou lavina se splátkou navíc ${s.debts.extra}: ${s.debts.savedLabel} ${s.debts.saved}, ${s.debts.sooner}.`,
  coach: `Kapsa, AI kouč: zpráva „${s.coach.you}“ a odpověď „${s.coach.reply.join(' ')}“`,
  salary: `Kapsa, kam jde výplata ${s.salary.total}: ${s.salary.parts.map((p) => `${p.label} ${p.value}`).join(', ')}.`,
  afford: `Kapsa, můžu si to dovolit: ${s.afford.item} za ${s.afford.price}, denní limit klesne z ${s.afford.limitNow} na ${s.afford.limitAfter}.`,
  remind: `Kapsa, večerní připomínka v ${s.remind.time}: ${s.remind.text}`,
  insight: `Kapsa, co vidím: ${s.insight.map((i) => i.title).join(', ')}.`,
}

export function KapsaPhone({ screen, className }: { screen: KapsaScreen; className?: string }) {
  return (
    <span className={cx('br-ph kp-ph', className)} role="img" aria-label={`${LABELS[screen]} (${s.example.toLowerCase()})`}>
      <span className={cx('kp-scr', `kp-${screen}`)} aria-hidden="true">
        {screen === 'remind' ? <Remind /> : (
          <>
            <Status />
            <span className="kp-body">{BODY[screen]()}</span>
            <Tabs active={screen === 'debts' ? 1 : screen === 'coach' ? 2 : 0} />
          </>
        )}
      </span>
    </span>
  )
}

function Status() {
  return (
    <span className="kp-status"><b>9:41</b><i className="kp-isl" /><span className="kp-sig"><i /><i /><i /></span></span>
  )
}

function Tabs({ active }: { active: number }) {
  return (
    <span className="kp-tabs">
      {['Dnes', 'Dluhy', 'Kouč', 'Já'].map((t, i) => (
        <span key={t} className={cx(i === active && 'kp-on')}><i />{t}</span>
      ))}
    </span>
  )
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <span className="kp-head">
      <b>{title}</b>
      {sub && <small>{sub}</small>}
    </span>
  )
}

const BODY: Record<Exclude<KapsaScreen, 'remind'>, () => ReactNode> = {
  today: () => {
    const t = s.today
    return (
      <>
        <Head title="Dnes" sub={`${t.days} dní do výplaty`} />
        <span className="kp-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" className="kp-trk" />
            <circle cx="50" cy="50" r="42" className="kp-arc" pathLength="100" strokeDasharray="72 100" />
          </svg>
          <span className="kp-big"><b>{t.limit}</b><small>{t.limitLabel}</small></span>
        </span>
        <span className="kp-card kp-ask">
          <b>{t.ask}</b>
          <span className="kp-btns"><span className="kp-yes">{t.yes}</span><span>{t.no}</span></span>
        </span>
        <span className="kp-card kp-next">
          <small>{t.next.label}</small>
          <b>{t.next.title}</b>
          <span className="kp-bar"><i style={{ '--p': t.next.progress } as CSSProperties} /></span>
          <small className="kp-val">{t.next.value}</small>
        </span>
      </>
    )
  },
  debts: () => {
    const d = s.debts
    return (
      <>
        <Head title={d.title} />
        <span className="kp-seg">{d.modes.map((m, i) => <span key={m} className={cx(i === 0 && 'kp-on')}>{m}</span>)}</span>
        {d.items.map((it, i) => (
          <span key={it.name} className="kp-card kp-debt">
            <span className="kp-row"><b>{it.name}</b><span>{it.balance}</span></span>
            <span className="kp-row kp-dim"><span>{i === 0 ? '1. na řadě' : '2. na řadě'}</span><span>RPSN {it.rate}</span></span>
            <span className="kp-bar"><i style={{ '--p': it.paid } as CSSProperties} /></span>
          </span>
        ))}
        <span className="kp-card kp-extra">
          <span className="kp-row"><small>{d.extraLabel}</small><b>{d.extra}</b></span>
          <span className="kp-slide"><i className="kp-fill" /><i className="kp-thumb" /></span>
        </span>
        <span className="kp-card kp-saved">
          <b>{d.saved}</b>
          <small>{d.savedLabel}</small>
          <span className="kp-pill">{d.sooner}</span>
        </span>
      </>
    )
  },
  coach: () => {
    const c = s.coach
    return (
      <>
        <Head title={c.title} />
        <span className="kp-chat">
          <span className="kp-msg kp-you kp-m1">{c.you}</span>
          <span className="kp-msg kp-bot kp-m2"><b className="kp-ok">✓</b>{c.reply[0]}<br />{c.reply[1]}</span>
          <span className="kp-msg kp-bot kp-m3">{c.tip}</span>
          <span className="kp-chips kp-m3">{c.chips.map((x) => <span key={x}>{x}</span>)}</span>
        </span>
        <span className="kp-input">{c.input}<i /></span>
      </>
    )
  },
  salary: () => {
    const v = s.salary
    return (
      <>
        <Head title="Kam jde výplata" />
        <span className="kp-total"><small>Čistá výplata</small><b>{v.total}</b></span>
        <span className="kp-stack">
          {v.parts.map((p, i) => <i key={p.label} className={`kp-c${i}`} style={{ flexGrow: p.share }} />)}
        </span>
        {v.parts.map((p, i) => (
          <span key={p.label} className="kp-card kp-part">
            <span className={`kp-dot kp-c${i}`} /><span>{p.label}</span><b>{p.value}</b>
          </span>
        ))}
      </>
    )
  },
  afford: () => {
    const a = s.afford
    return (
      <>
        <Head title="Můžu si to dovolit?" />
        <span className="kp-card kp-field"><small>Co chcete koupit</small><b>{a.item}</b></span>
        <span className="kp-card kp-field"><small>Cena</small><b>{a.price}</b></span>
        <span className="kp-card kp-after">
          <small>Denní limit po nákupu</small>
          <span className="kp-row"><s>{a.limitNow}</s><span className="kp-arrow">→</span><b>{a.limitAfter}</b></span>
        </span>
        <span className="kp-card kp-saved">
          <b>{a.debt}</b>
          <small>{a.debtLabel}</small>
        </span>
        <span className="kp-btns"><span>{a.buy}</span><span className="kp-yes">{a.pay}</span></span>
      </>
    )
  },
  insight: () => (
    <>
      <Head title="Co vidím" />
      {s.insight.map((i, n) => (
        <span key={i.title} className={cx('kp-card kp-tip', `kp-t${n}`)}>
          <span className="kp-ic">{['!', '↑', '↻', '¤'][n]}</span>
          <span><b>{i.title}</b><small>{i.text}</small></span>
        </span>
      ))}
    </>
  ),
}

function Remind() {
  const r = s.remind
  return (
    <>
      <span className="kp-lock">
        <span className="kp-isl kp-isl-l" />
        <b className="kp-clock">{r.time}</b>
        <small>Dnes</small>
      </span>
      <span className="kp-note">
        <span className="kp-app">K</span>
        <span>
          <span className="kp-row"><b>{r.title}</b><small>teď</small></span>
          <span className="kp-ntext">{r.text}</span>
        </span>
      </span>
      <span className="kp-lockbar"><i /><i /></span>
    </>
  )
}
