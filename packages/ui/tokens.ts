// The design tokens as data, for documentation (/design) and for code that needs raw values
// (canvas, OG images). styles/assetra.css is what the browser uses; __tests__/ad-tokens.test.mjs
// keeps the two in sync.

export const tokens = {
  dark: {
    bg: '#0b0a0c',
    bg2: '#121014',
    fg: '#f2eef0',
    fg2: '#b0a8ad',
    fg3: '#91898e',
    line: 'rgba(242,238,240,.09)',
    line2: 'rgba(242,238,240,.18)',
    acc: '#ff5ad2',
    acc2: '#c19bff',
    accInk: '#1c0517',
    accText: '#ff5ad2',
  },
  light: {
    bg: '#efedee',
    bg2: '#e5e2e4',
    fg: '#141215',
    fg2: '#3e393d',
    fg3: '#5d565b',
    line: 'rgba(20,18,21,.1)',
    line2: 'rgba(20,18,21,.22)',
    acc: '#e040c8',
    acc2: '#9a6cf0',
    accInk: '#1c0517',
    accText: '#a3168f',
  },
} as const

export type TokenName = keyof typeof tokens.dark

export const tokenLabels: Record<TokenName, string> = {
  bg: 'Pozadí',
  bg2: 'Pozadí 2',
  fg: 'Text',
  fg2: 'Text 2',
  fg3: 'Text 3',
  line: 'Linka',
  line2: 'Linka 2',
  acc: 'Akcent (magenta)',
  acc2: 'Akcent 2 (lila)',
  accInk: 'Text na akcentu',
  accText: 'Akcent jako text',
}

export const radii = { card: 28, pill: 999, field: 16 } as const
export const ease = 'cubic-bezier(.16,1,.3,1)'
export const glass = {
  background: 'linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.015))',
  backdrop: 'blur(20px) saturate(170%)',
  border: 'rgba(255,255,255,.12)',
  highlight: 'inset 0 1px 0 rgba(255,255,255,.22)',
} as const
