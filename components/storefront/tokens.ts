import type { ShopManifest } from '@/types/manifest'

const radiusMap: Record<string, string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  full: '9999px',
}

const densityMap: Record<string, string> = {
  tight: '0.75',
  normal: '1',
  airy: '1.35',
}

export function manifestToCssVars(manifest: ShopManifest): Record<string, string> {
  const { palette, radius, density, typography } = manifest.design
  return {
    '--s-bg': palette.bg,
    '--s-surface': palette.surface,
    '--s-text': palette.text,
    '--s-muted': palette.muted,
    '--s-accent': palette.accent,
    '--s-accent-text': palette.accentText,
    '--s-border': palette.border,
    '--s-radius': radiusMap[radius] ?? '8px',
    '--s-space': densityMap[density] ?? '1',
    '--s-font-heading': `"${typography.headingFont}", Georgia, serif`,
    '--s-font-body': `"${typography.bodyFont}", system-ui, sans-serif`,
  }
}

export function buildFontUrl(manifest: ShopManifest): string {
  const { headingFont, bodyFont } = manifest.design.typography
  const fonts = [...new Set([headingFont, bodyFont])]
  const families = fonts
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${families}&display=swap`
}
