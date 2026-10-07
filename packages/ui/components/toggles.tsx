'use client'

import { setMotion, setTheme, useMotionSetting, useTheme } from '../theme'

type Lang = 'cs' | 'en'

const T = {
  cs: { toLight: 'Přepnout na světlý motiv', toDark: 'Přepnout na tmavý motiv', motionOff: 'Vypnout animace', motionOn: 'Zapnout animace' },
  en: { toLight: 'Switch to light theme', toDark: 'Switch to dark theme', motionOff: 'Turn animations off', motionOn: 'Turn animations on' },
} as const

/** Light / dark switch (round glass icon button from the nav). */
export function ThemeToggle({ lang = 'cs' }: { lang?: Lang }) {
  const theme = useTheme()
  const label = theme === 'dark' ? T[lang].toLight : T[lang].toDark
  return (
    <button className="ib" type="button" aria-label={label} title={label} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
    </button>
  )
}

/** Animations on / off. Applies to CSS animations, scroll effects and the particles. */
export function MotionToggle({ lang = 'cs' }: { lang?: Lang }) {
  const on = useMotionSetting()
  const label = on ? T[lang].motionOff : T[lang].motionOn
  return (
    <button className="ib" type="button" aria-pressed={!on} aria-label={label} title={label} onClick={() => setMotion(!on)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {on ? <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" /> : <path d="M3 12h18" />}
      </svg>
    </button>
  )
}
