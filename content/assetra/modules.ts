// The Quante modules as presented on the AssetraDigital website. Status is what the code in
// this repo actually ships (verified 2026-10-07) — never present something as done that is not:
//  - generate: /new → /api/quante/generate, self-healing build fixes (MAX_AUTO_FIX_ATTEMPTS)
//  - qdit:     the Studio visual editor (lib/editor/*), desktop only
//  - qads:     /qads — ad photos and videos from uploaded product photos, download only
//  - qscan, qails, qgent: no product code yet → 'dev' (no way into the app)

export type ModuleStatus = 'live' | 'dev'

export interface QuanteModule {
  slug: 'generate' | 'qscan' | 'qgent' | 'qdit' | 'qads' | 'qails'
  name: string
  /** one-line description used on the homepage card */
  short: string
  /** small mono tag on the card */
  tag: string
  status: ModuleStatus
  /** particle shapes of the module page zone */
  shapes: string[]
}

// Order of the cards on the homepage (as in the design).
export const modules: QuanteModule[] = [
  { slug: 'generate', name: 'Quante Generate', short: 'Celý e-shop z textového zadání.', tag: 'generátor', status: 'live', shapes: ['GEN'] },
  { slug: 'qscan', name: 'Qscan', short: 'Sken stávajícího e-shopu podle adresy, rovnou do Quante.', tag: 'sken', status: 'dev', shapes: ['SCAN'] },
  { slug: 'qgent', name: 'Qgent', short: 'Agent, který s vámi projde celý e-shop a po vašem potvrzení ho upraví.', tag: 'agent', status: 'dev', shapes: ['AGENT'] },
  { slug: 'qdit', name: 'Qdit', short: 'Ruční úpravy přímo na stránce: klik, přepsat, přesunout.', tag: 'editor', status: 'live', shapes: ['EDIT'] },
  { slug: 'qads', name: 'Qads', short: 'Reklamní videa a fotky pro váš e-shop, připravené ke stažení.', tag: 'reklamy', status: 'live', shapes: ['ADS'] },
  { slug: 'qails', name: 'Qails', short: 'E-maily všech vašich obchodů na jednom místě.', tag: 'e-maily', status: 'dev', shapes: ['@'] },
]

export const quanteIntro = {
  label: 'Quante',
  title: 'Quante',
  sub: 'Celý e-shop na jednom místě: vygenerovat, upravit, propagovat a spravovat.',
}

export const moduleHref = (m: Pick<QuanteModule, 'slug'>) => '/quante/' + m.slug
