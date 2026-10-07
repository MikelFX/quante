import { InView, SectionLabel, SectionTitle, Todo } from '@ad/ui'

/**
 * A company document that does not exist yet (obchodní podmínky, ochrana osobních údajů,
 * vzorová smlouva). Shows a visible placeholder instead of invented legal text.
 */
export function DocPlaceholder({ title }: { title: string }) {
  return (
    <InView className="doc-page" initial>
      <div className="w">
        <SectionLabel num="§">Dokumenty</SectionLabel>
        <SectionTitle as="h1">{title}</SectionTitle>
        <div className="doc-body glass rv">
          <p>
            Text dokumentu připravujeme. <Todo>[doplnit: {title.toLowerCase()}]</Todo>
          </p>
        </div>
      </div>
    </InView>
  )
}
