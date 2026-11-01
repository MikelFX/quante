import { SectionTitle, Sub, delay } from '@ad/ui'
import { quanteStart } from '@/content/assetra/modules'

// /quante: "what do you want to do first?" — each card opens the app's onboarding (/start) with the
// goal already picked, so a visitor goes from the website to their first action in a few clicks.
export function QuanteStart() {
  return (
    <>
      <SectionTitle>{quanteStart.title}</SectionTitle>
      <Sub>{quanteStart.sub}</Sub>
      <div className="qst">
        {quanteStart.goals.map((g, i) => (
          <a key={g.goal} href={g.href} className="card glass spot qst-card rv" style={delay(0.1 + i * 0.08)}>
            <span className="qst-mod">{g.module}</span>
            <h3>{g.title}</h3>
            <p>{g.text}</p>
            <span className="qst-go">Začít<span className="qst-ar" aria-hidden="true">→</span></span>
          </a>
        ))}
      </div>
    </>
  )
}
