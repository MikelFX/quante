import { ImageResponse } from 'next/og'
import { tokens } from '@ad/ui/tokens'

// Open Graph image for the AssetraDigital homepage (and its pages that don't override it).
// The OG renderer cannot use variable fonts and Google serves no static 62 %-width Archivo, so
// the headline uses Archivo Narrow 700 (static), fetched for just the glyphs we draw. If Google
// Fonts is unreachable the image still renders with the default font.

export const alt = 'Assetra Digital — web nebo e-shop bez vstupní investice'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TITLE = ['Web nebo e-shop', 'bez vstupní', 'investice']
const SUB = '0 Kč předem · hosting, správa a drobné úpravy v měsíčním paušálu'
const t = tokens.dark

async function narrow(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@700&text=${encodeURIComponent(text)}`)).text()
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1]
    return url ? await (await fetch(url)).arrayBuffer() : null
  } catch {
    return null
  }
}

export default async function Image() {
  // The default OG font has no Czech diacritics (č, ř, š), so every line uses the fetched font.
  const display = await narrow(TITLE.join(' ').toUpperCase() + 'ASSETRADIGITAL' + SUB)
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: t.bg, color: t.fg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="66" height="48" viewBox="0 0 44 32">
            <path d="M3 29 L20 3 L20 29 M20 3 H25 A13 13 0 0 1 25 29 H20" fill="none" stroke={t.fg} strokeWidth="3.2" strokeLinecap="square" />
            <rect x="12.6" y="18.2" width="4.6" height="4.6" fill={t.acc} />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 20, letterSpacing: 4, fontWeight: 700, lineHeight: 1.2, ...(display ? { fontFamily: 'Archivo Narrow' } : {}) }}>
            <span>ASSETRA</span>
            <span>DIGITAL</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', ...(display ? { fontFamily: 'Archivo Narrow' } : {}), fontSize: 104, lineHeight: 0.93, textTransform: 'uppercase' }}>
          {TITLE.map((line, i) => (
            <span key={line} style={{ color: i === 2 ? t.acc : t.fg }}>{line}</span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, color: t.fg2, ...(display ? { fontFamily: 'Archivo Narrow' } : {}) }}>
          <div style={{ width: 44, height: 4, background: t.acc }} />
          {SUB}
        </div>
      </div>
    ),
    { ...size, ...(display ? { fonts: [{ name: 'Archivo Narrow', data: display, weight: 700 as const, style: 'normal' as const }] } : {}) },
  )
}
