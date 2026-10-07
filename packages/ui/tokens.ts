// The design tokens as data, for documentation (/design) and for code that needs raw values
// (canvas, OG images). styles/assetra.css is what the browser uses; __tests__/ad-tokens.test.mjs
// keeps the two in sync.

export const tokens = {
  dark: {
    bg: '#070808',
    bg2: '#0d0f0f',
    fg: '#eef2f0',
    fg2: '#a9b0ac',
    fg3: '#8a918d',
    line: 'rgba(238,242,240,.09)',
    line2: 'rgba(238,242,240,.18)',
    acc: '#5ff5c4',
    acc2: '#7cc8ff',
    accInk: '#03130d',
    accText: '#5ff5c4',
  },
  light: {
    bg: '#eef0ee',
    bg2: '#e4e7e4',
    fg: '#0b0d0c',
    fg2: '#3b413e',
    fg3: '#5a615d',
    line: 'rgba(11,13,12,.1)',
    line2: 'rgba(11,13,12,.22)',
    acc: '#2fe0a3',
    acc2: '#4a9eea',
    accInk: '#03130d',
    accText: '#057a56',
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
  acc: 'Akcent (mint)',
  acc2: 'Akcent 2 (ice)',
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
