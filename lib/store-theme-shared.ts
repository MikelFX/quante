// Store theme rules shared by the Studio theme panel (client) and the platform API
// (lib/store-theme.ts). No imports on purpose: it ships to the browser, and
// __tests__/store-theme.test.mjs loads it through Node's type stripping.
//
// lib/store-template/build.ts keeps its own copy of the constants (it embeds them into
// the store's ThemeStyle / ThemeBridge and may not import '@/…' at runtime); the test
// asserts both copies are identical — change them together.

export const THEME_COLOR_VARS = {
  bg: '--color-bg',
  surface: '--color-surface',
  text: '--color-text',
  muted: '--color-muted',
  accent: '--color-accent',
  accentText: '--color-accent-text',
  border: '--color-border',
} as const
export type ThemeColorKey = keyof typeof THEME_COLOR_VARS
export const THEME_COLOR_KEYS = Object.keys(THEME_COLOR_VARS) as ThemeColorKey[]

export const THEME_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]{1,60}\))$/
export const THEME_FONT_RE = /^[A-Za-z0-9 ,'"-]{1,200}$/
export const THEME_RADIUS_RE = /^(?:0|\d{1,3}(?:\.\d{1,2})?(?:px|rem|em))$/

export interface ThemeFontOption { name: string; stack: string; weights: string; kind: 'sans' | 'serif' | 'mono' }

export const THEME_FONT_OPTIONS: ReadonlyArray<ThemeFontOption> = [
  { name: 'Inter', stack: 'Inter, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'DM Sans', stack: "'DM Sans', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'Manrope', stack: 'Manrope, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Plus Jakarta Sans', stack: "'Plus Jakarta Sans', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'Space Grotesk', stack: "'Space Grotesk', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'Outfit', stack: 'Outfit, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Poppins', stack: 'Poppins, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Montserrat', stack: 'Montserrat, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Work Sans', stack: "'Work Sans', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'IBM Plex Sans', stack: "'IBM Plex Sans', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'Jost', stack: 'Jost, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Nunito', stack: 'Nunito, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Rubik', stack: 'Rubik, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Karla', stack: 'Karla, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Archivo', stack: 'Archivo, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Bricolage Grotesque', stack: "'Bricolage Grotesque', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'Syne', stack: 'Syne, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Open Sans', stack: "'Open Sans', sans-serif", weights: '400;500;600;700', kind: 'sans' },
  { name: 'Roboto', stack: 'Roboto, sans-serif', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Lato', stack: 'Lato, sans-serif', weights: '400;700', kind: 'sans' },
  { name: 'Playfair Display', stack: "'Playfair Display', serif", weights: '400;500;600;700', kind: 'serif' },
  { name: 'Cormorant Garamond', stack: "'Cormorant Garamond', serif", weights: '400;500;600;700', kind: 'serif' },
  { name: 'Fraunces', stack: 'Fraunces, serif', weights: '400;500;600;700', kind: 'serif' },
  { name: 'Lora', stack: 'Lora, serif', weights: '400;500;600;700', kind: 'serif' },
  { name: 'Source Serif 4', stack: "'Source Serif 4', serif", weights: '400;500;600;700', kind: 'serif' },
  { name: 'EB Garamond', stack: "'EB Garamond', serif", weights: '400;500;600;700', kind: 'serif' },
  { name: 'Libre Baskerville', stack: "'Libre Baskerville', serif", weights: '400;700', kind: 'serif' },
  { name: 'DM Serif Display', stack: "'DM Serif Display', serif", weights: '400', kind: 'serif' },
  { name: 'Instrument Serif', stack: "'Instrument Serif', serif", weights: '400', kind: 'serif' },
  { name: 'IBM Plex Mono', stack: "'IBM Plex Mono', monospace", weights: '400;500;600;700', kind: 'mono' },
  { name: 'Space Mono', stack: "'Space Mono', monospace", weights: '400;700', kind: 'mono' },
]

export interface StoreTheme {
  colors: Record<ThemeColorKey, string>
  fonts: { heading: string; body: string }
  radius: string
}

/** First family of a CSS font stack, unquoted ("'DM Sans', sans-serif" → "DM Sans"). */
export function themeFirstFamily(stack: string): string {
  return stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}

/** Google Fonts css2 URL for the offered families among `stacks` (others are left to the store's own CSS). */
export function themeFontsHref(stacks: string[]): string | null {
  const weights = new Map(THEME_FONT_OPTIONS.map((f) => [f.name, f.weights]))
  const families = Array.from(new Set(stacks.map(themeFirstFamily))).filter((f) => weights.has(f))
  if (families.length === 0) return null
  return 'https://fonts.googleapis.com/css2?' +
    families.map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@' + weights.get(f)).join('&') +
    '&display=swap'
}

/** Validates a theme. Returns null when any value is missing or not allowed. */
export function sanitizeTheme(input: unknown): StoreTheme | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { colors?: Record<string, unknown>; fonts?: Record<string, unknown>; radius?: unknown }
  const colors = {} as Record<ThemeColorKey, string>
  for (const key of THEME_COLOR_KEYS) {
    const v = raw.colors?.[key]
    if (typeof v !== 'string' || !THEME_COLOR_RE.test(v.trim())) return null
    colors[key] = v.trim()
  }
  const heading = raw.fonts?.heading
  const body = raw.fonts?.body
  if (typeof heading !== 'string' || !THEME_FONT_RE.test(heading.trim())) return null
  if (typeof body !== 'string' || !THEME_FONT_RE.test(body.trim())) return null
  if (typeof raw.radius !== 'string' || !THEME_RADIUS_RE.test(raw.radius.trim())) return null
  return { colors, fonts: { heading: heading.trim(), body: body.trim() }, radius: raw.radius.trim() }
}

/** The ThemeBridge message payload for the Studio's live preview. */
export function themePreviewPayload(theme: StoreTheme): { vars: Record<string, string>; fontsHref: string | null } {
  const vars: Record<string, string> = {}
  for (const key of THEME_COLOR_KEYS) vars[THEME_COLOR_VARS[key]] = theme.colors[key]
  vars['--font-heading'] = theme.fonts.heading
  vars['--font-body'] = theme.fonts.body
  vars['--radius'] = theme.radius
  return { vars, fontsHref: themeFontsHref([theme.fonts.heading, theme.fonts.body]) }
}

/** `source` of every postMessage between the Studio and a store's ThemeBridge. */
export const THEME_MESSAGE_SOURCE = 'store-theme-editor'
