'use client'

import { useSyncExternalStore } from 'react'

// Theme and motion live as attributes on <html> (data-theme="dark|light", data-motion="on|off"),
// set before the first paint by <ThemeScript> in the root layout and persisted in localStorage.

export const THEME_KEY = 'ad-theme'
export const MOTION_KEY = 'ad-motion'

export type Theme = 'dark' | 'light'

const html = () => document.documentElement

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb)
  mo.observe(html(), { attributes: true, attributeFilter: ['data-theme', 'data-motion'] })
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', cb)
  return () => {
    mo.disconnect()
    mq.removeEventListener('change', cb)
  }
}

const readTheme = (): Theme => (html().getAttribute('data-theme') === 'light' ? 'light' : 'dark')
const readMotion = () => html().getAttribute('data-motion') !== 'off'
const readReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'dark')
}

/** The user's animation switch (independent of prefers-reduced-motion). */
export function useMotionSetting(): boolean {
  return useSyncExternalStore(subscribe, readMotion, () => true)
}

/** True when animations may run: switch on and no reduced-motion preference. */
export function useMotionAllowed(): boolean {
  const on = useMotionSetting()
  const reduced = useSyncExternalStore(subscribe, readReduced, () => false)
  return on && !reduced
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode / blocked storage: the choice still applies for this page view
  }
}

export function setTheme(theme: Theme) {
  html().setAttribute('data-theme', theme)
  store(THEME_KEY, theme)
}

export function setMotion(on: boolean) {
  html().setAttribute('data-motion', on ? 'on' : 'off')
  store(MOTION_KEY, on ? 'on' : 'off')
}
