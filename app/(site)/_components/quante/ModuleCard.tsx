import Link from 'next/link'
import { delay } from '@ad/ui'
import { moduleHref, type Locale, type QuanteModule } from '@/content/assetra/modules'
import { ModuleVisual } from '../ModuleVisual'
import { uiCopy } from './ui-copy'

/** Product card of the design (animated mini-UI + name + tags), linking to the module page. */
export function ModuleCard({ m, i, locale = 'cs' }: { m: QuanteModule; i: number; locale?: Locale }) {
  const t = uiCopy(locale)
  return (
    <article className="prod glass spot rv" style={delay(0.1 * ((i % 3) + 1))}>
      <ModuleVisual slug={m.slug} locale={locale} />
      <div className="pb">
        <h3>{m.name}</h3>
        <p>{m.short}</p>
        <div className="lk">
          <span>{m.tag}</span>
          {m.status === 'dev' && <span className="wip">{t.inDev}</span>}
          {m.badge && m.badge !== m.tag && <span className="mc-new">{m.badge}</span>}
          <Link href={moduleHref(m, locale)} aria-label={`${m.name}: ${t.moduleDetailAria}`}>{t.moduleDetail}</Link>
          {m.app && <a className="mc-go" href={m.app.href} aria-label={`${m.name}: ${m.app.label}`}>{m.app.label} →</a>}
        </div>
      </div>
    </article>
  )
}
