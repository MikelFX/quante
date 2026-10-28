import type { ReactNode } from 'react'
import { InView, SectionLabel, SectionTitle, Todo } from '@ad/ui'
import { legalFacts, type LegalDocument } from '@/content/assetra/legal'

/**
 * A company document from content/assetra/legal.ts. Unknown facts render as visible
 * [placeholders] (never invented); `{{_…}}` blanks of the sample contract render as fill-in lines.
 */
function fill(text: string): ReactNode[] {
  return text.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
    const m = part.match(/^\{\{([?_]?)([^}]+)\}\}$/)
    if (!m) return part
    const [, kind, key] = m
    if (kind === '_') return <span key={i} className="doc-blank">{key}</span>
    if (kind === '?') return <Todo key={i}>[{key}]</Todo>
    const fact = legalFacts[key]
    return fact?.value ?? <Todo key={i}>[{fact?.label ?? key}]</Todo>
  })
}

export function LegalDoc({ doc }: { doc: LegalDocument }) {
  return (
    <InView className="doc-page" initial>
      <div className="w">
        <SectionLabel num="§">Dokumenty</SectionLabel>
        <SectionTitle as="h1">{doc.title}</SectionTitle>
        <p className="sub">{doc.lead}</p>
        <article className="doc-body doc-legal glass rv">
          {doc.effective && <p className="doc-meta">Účinné od {fill(doc.effective)}</p>}
          {doc.sections.map((s, i) => (
            <section key={s.h}>
              <h2>{doc.signatures ? s.h : `${i + 1}. ${s.h}`}</h2>
              {s.p?.map((t, j) => <p key={j}>{fill(t)}</p>)}
              {s.ol && <ol>{s.ol.map((t, j) => <li key={j}>{fill(t)}</li>)}</ol>}
              {s.ul && <ul>{s.ul.map((t, j) => <li key={j}>{fill(t)}</li>)}</ul>}
              {s.after?.map((t, j) => <p key={j}>{fill(t)}</p>)}
            </section>
          ))}
          {doc.signatures && (
            <div className="doc-signs">
              <div><span className="doc-blank">místo, datum</span><span className="doc-line" /><b>Poskytovatel</b></div>
              <div><span className="doc-blank">místo, datum</span><span className="doc-line" /><b>Objednatel</b></div>
            </div>
          )}
        </article>
      </div>
    </InView>
  )
}
