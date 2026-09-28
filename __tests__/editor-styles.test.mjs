// Visual editor design panel (lib/editor/styles.ts): classification of utilities and the
// Framer-style breakpoint cascade (Desktop flows down unless overridden).
// Usage: node --test __tests__/editor-styles.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const S = await import(new URL('../lib/editor/styles.ts', import.meta.url).href)

test('classifies text-* correctly (size vs align vs color vs other)', () => {
  assert.equal(S.classifyUtility('text-3xl'), 'fontSize')
  assert.equal(S.classifyUtility('text-[18px]'), 'fontSize')
  assert.equal(S.classifyUtility('text-[clamp(2rem,5vw,4rem)]'), 'fontSize')
  assert.equal(S.classifyUtility('text-center'), 'textAlign')
  assert.equal(S.classifyUtility('text-muted'), 'textColor')
  assert.equal(S.classifyUtility('text-accent-text'), 'textColor')
  assert.equal(S.classifyUtility('text-[#ff0000]'), 'textColor')
  assert.equal(S.classifyUtility('text-white/80'), 'textColor')
  assert.equal(S.classifyUtility('text-balance'), null)
  assert.equal(S.classifyUtility('[font-size:inherit]'), 'fontSize')
})

test('classifies other groups and leaves unrelated utilities alone', () => {
  const cases = {
    'font-heading': 'fontFamily', 'font-semibold': 'fontWeight', 'leading-tight': 'lineHeight',
    'tracking-[0.2em]': 'letterSpacing', 'bg-surface': 'bgColor', 'bg-cover': null, 'bg-[url(/a.png)]': null,
    'px-6': 'padding', 'pt-2': 'padding', '-mt-4': 'margin', 'mx-auto': 'margin', 'max-w-3xl': 'maxWidth',
    'w-full': 'width', 'h-12': 'height', 'flex': 'display', 'hidden': 'display', 'flex-col': 'flexDirection',
    'flex-1': null, 'items-center': 'align', 'justify-between': 'justify', 'gap-x-4': 'gap', 'grid-cols-3': 'gridCols',
    'rounded-store': 'radius', 'rounded-t-lg': 'radius', 'border': 'borderWidth', 'border-t-2': 'borderWidth',
    'border-border': 'borderColor', 'border-dashed': null, 'shadow-lg': 'shadow', 'object-cover': 'objectFit',
    'pointer-events-none': null, 'placeholder-muted': null, 'min-h-screen': null, 'transition': null,
  }
  for (const [cls, group] of Object.entries(cases)) assert.equal(S.classifyUtility(cls), group, cls)
})

test('desktop edit without responsive classes applies everywhere', () => {
  const out = S.applyStyleEdits('font-heading text-2xl text-text', [{ group: 'fontSize', value: ['text-[40px]'] }], 'desktop', 'h2')
  assert.equal(out, 'font-heading text-[40px] text-text')
})

test('desktop edit keeps a phone override, flows to tablet (Framer cascade)', () => {
  const out = S.applyStyleEdits('font-heading text-3xl md:text-4xl mb-4', [{ group: 'fontSize', value: ['text-[48px]'] }], 'desktop', 'h2')
  assert.equal(out, 'font-heading text-3xl md:text-[48px] mb-4')
})

test('desktop edit keeps an explicit tablet value; xl variants are replaced', () => {
  const out = S.applyStyleEdits('text-3xl md:text-4xl lg:text-5xl xl:text-6xl', [{ group: 'fontSize', value: ['text-[64px]'] }], 'desktop', 'h1')
  assert.equal(out, 'text-3xl md:text-4xl lg:text-[64px]')
})

test('phone edit on an unset larger breakpoint writes a reset there', () => {
  assert.equal(S.applyStyleEdits('font-bold', [{ group: 'fontSize', value: ['text-[14px]'] }], 'phone', 'p'), 'font-bold text-[14px] md:[font-size:inherit]')
  assert.equal(S.applyStyleEdits('p-8', [{ group: 'padding', value: ['p-[12px]'] }], 'phone', 'div'), 'p-[12px] md:p-8')
})

test('tablet edit flows to phone when phone had no own value, not to desktop', () => {
  assert.equal(S.applyStyleEdits('text-2xl', [{ group: 'fontSize', value: ['text-[30px]'] }], 'tablet', 'h2'), 'text-[30px] lg:text-2xl')
})

test('hide on phone only keeps the display on larger screens', () => {
  assert.equal(S.applyStyleEdits('flex items-center gap-2', [{ group: 'display', value: ['hidden'] }], 'phone', 'div'), 'hidden md:flex items-center gap-2')
  assert.equal(S.applyStyleEdits('text-sm', [{ group: 'display', value: ['hidden'] }], 'phone', 'div'), 'text-sm hidden md:block')
  // show again on phone → back to the plain class list
  assert.equal(S.applyStyleEdits('hidden md:flex items-center', [{ group: 'display', value: ['flex'] }], 'phone', 'div'), 'flex items-center')
})

test('clearing a value and state variants are left alone', () => {
  assert.equal(S.applyStyleEdits('bg-accent hover:bg-surface px-4', [{ group: 'bgColor', value: null }], 'desktop', 'a'), 'hover:bg-surface px-4')
  assert.equal(S.applyStyleEdits('p-4', [{ group: 'padding', value: ['p-4'] }], 'desktop', 'div'), 'p-4')
})

test('several edits at once (layout switch to a vertical stack)', () => {
  const out = S.applyStyleEdits('max-w-3xl mx-auto', [{ group: 'display', value: ['flex'] }, { group: 'flexDirection', value: ['flex-col'] }], 'desktop', 'div')
  assert.equal(out, 'max-w-3xl mx-auto flex flex-col')
})

test('groupValues reports what each device sees', () => {
  const v = S.groupValues('text-3xl md:text-4xl', 'fontSize')
  assert.deepEqual(v, { desktop: ['text-4xl'], tablet: ['text-4xl'], phone: ['text-3xl'] })
})

test('value helpers', () => {
  assert.equal(S.colorClass('text', 'accent'), 'text-accent')
  assert.equal(S.colorClass('bg', '#FFAA00'), 'bg-[#ffaa00]')
  assert.equal(S.colorClass('bg', 'red; x'), null)
  assert.equal(S.colorOfClass('border', ['border-border']), 'border')
  assert.equal(S.colorOfClass('text', ['text-[#112233]']), '#112233')
  assert.equal(S.fontWeightClass(620), 'font-semibold')
  assert.deepEqual(S.boxClasses('p', { t: 8, r: 8, b: 8, l: 8 }), ['p-[8px]'])
  assert.deepEqual(S.boxClasses('p', { t: 12, r: 24, b: 12, l: 24 }), ['px-[24px]', 'py-[12px]'])
  assert.deepEqual(S.boxClasses('m', { t: 0, r: 'auto', b: 16, l: 'auto' }), ['mt-0', 'mr-auto', 'mb-[16px]', 'ml-auto'])
  assert.deepEqual(S.boxClasses('m', { t: -8, r: 0, b: -8, l: 0 }), ['mx-0', '-my-[8px]'])
  assert.equal(S.pxClass('gap', 0), 'gap-0')
  assert.equal(S.pxClass('rounded', 12), 'rounded-[12px]')
})
