'use client'

import { setMotion, setTheme, useMotionSetting, useTheme } from '../theme'

/** Light / dark switch (round glass icon button from the nav). */
export function ThemeToggle() {
  const theme = useTheme()
  return (
    <button
      className="ib"
      type="button"
      aria-label={theme === 'dark' ? 'Přepnout na světlý motiv' : 'Přepnout na tmavý motiv'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
    </button>
  )
}

/** Animations on / off. Applies to CSS animations, scroll effects and the particles. */
export function MotionToggle() {
  const on = useMotionSetting()
  return (
    <button
      className="ib"
      type="button"
      aria-pressed={!on}
      aria-label={on ? 'Vypnout animace' : 'Zapnout animace'}
      title={on ? 'Vypnout animace' : 'Zapnout animace'}
      onClick={() => setMotion(!on)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {on ? (
          <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />
        ) : (
          <path d="M3 12h18" />
        )}
      </svg>
    </button>
  )
}
