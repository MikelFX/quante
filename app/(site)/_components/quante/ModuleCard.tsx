import Link from 'next/link'
import { delay } from '@ad/ui'
import { moduleHref, type QuanteModule } from '@/content/assetra/modules'
import { ModuleVisual } from '../ModuleVisual'

/** Product card of the design (animated mini-UI + name + tags), linking to the module page. */
export function ModuleCard({ m, i }: { m: QuanteModule; i: number }) {
  return (
    <article className="prod glass spot rv" style={delay(0.1 * ((i % 3) + 1))}>
      <ModuleVisual slug={m.slug} />
      <div className="pb">
        <h3>{m.name}</h3>
        <p>{m.short}</p>
        <div className="lk">
          <span>{m.tag}</span>
          {m.status === 'dev' && <span className="wip">Ve vývoji</span>}
          <Link href={moduleHref(m)} aria-label={`${m.name}: detail modulu`}>Detail modulu ↗</Link>
        </div>
      </div>
    </article>
  )
}
