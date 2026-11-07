import { QUANTE_EN_PATHS, QUANTE_PATHS, SITE_PATHS } from './domains'

// <html lang> for the shared, static root layout (app/layout.tsx): the same rule as pageLang() in
// lib/domains.ts, run while <head> is parsed so screen readers, translators and rendering crawlers
// see the page's real language. Without JS the server's lang="en" stays; next.config.ts also sends
// Content-Language for the Czech and English public pages.
const list = (l: readonly string[]) => JSON.stringify(l)

export const LANG_SCRIPT =
  '(function(){var p=location.pathname,m=function(l){return l.some(function(x){' +
  "return x.slice(-7)==='/:path*'?p.indexOf(x.slice(0,-7)+'/')===0:p===x})};" +
  `document.documentElement.lang=m(${list(QUANTE_EN_PATHS)})?'en':(p==='/'||m(${list(SITE_PATHS)})||m(${list(QUANTE_PATHS)}))?'cs':'en'})()`
