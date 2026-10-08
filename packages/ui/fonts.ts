import { Archivo, JetBrains_Mono } from 'next/font/google'

// Archivo is variable on both axes (wdth 62–125, wght 100–900): the design sets headlines at
// font-stretch 62–70 % and weight 850–900. Only the latin file (the hero headline) is preloaded;
// the latin-ext file with the Czech diacritics still loads by unicode-range as soon as a heading
// needs it. Preloading every subset of every font (~280 kB) held back the first paint on slow
// mobile connections (QA 2026-10-08).
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
  // next/font's automatic fallback assumes normal width. "AD Archivo Fallback" (app-tokens.css) is
  // Arial scaled to Archivo's condensed width, so headlines keep their line breaks when it arrives.
  adjustFontFallback: false,
  fallback: ['AD Archivo Fallback', 'sans-serif'],
})

// Labels and small print only: not preloaded, the metric-adjusted fallback covers the swap.
export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
})

/** Class names that define --font-archivo / --font-jetbrains-mono on a surface root. */
export const adFontVars = `${archivo.variable} ${jetbrainsMono.variable}`
