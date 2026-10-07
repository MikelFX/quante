// Writes content/qgent-knowledge.json from the website content (content/assetra/qgent.ts).
// Run after changing any site copy, prices or module data:  npm run qgent:knowledge
// __tests__/qgent.test.mjs fails while the JSON is out of date.
import { registerHooks } from 'node:module'
import { writeFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(specifier + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
})

const { buildQgentKnowledge } = await import('../content/assetra/qgent.ts')
const json = JSON.stringify(buildQgentKnowledge(), null, 2) + '\n'
writeFileSync(new URL('../content/qgent-knowledge.json', import.meta.url), json)
console.log(`content/qgent-knowledge.json: ${json.length} bytes`)
