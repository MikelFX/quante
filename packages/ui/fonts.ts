import { Archivo, JetBrains_Mono } from 'next/font/google'

// Archivo is variable on both axes (wdth 62–125, wght 100–900): the design sets headlines at
// font-stretch 62–70 % and weight 850–900. latin-ext carries the Czech diacritics.
export const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
  // The system fallback must be condensed too, or the headlines reflow when Archivo arrives.
  adjustFontFallback: false,
  fallback: ['Arial Narrow', 'Roboto Condensed', 'sans-serif'],
})

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

/** Class names that define --font-archivo / --font-jetbrains-mono on a surface root. */
export const adFontVars = `${archivo.variable} ${jetbrainsMono.variable}`
