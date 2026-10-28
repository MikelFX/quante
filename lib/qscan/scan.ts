// Qscan: walks an existing store from its address and collects what's in it — brand, copy,
// products (platform APIs, JSON-LD, OpenGraph), images, videos, colours, fonts, motion hints.
// Server-only. Polite and bounded: a fixed page budget, a few requests at a time, one deadline
// for the whole scan. All network access goes through scanFetch (SSRF-guarded).

import { ScanFetchError, scanFetch } from './fetch'
import { normalizeScanUrl } from './net'
import {
  brandName, detectPlatform, extractPage, fontFamilies, isProductSitemapUrl, mergeProducts, parseSitemap,
  PRODUCT_PATH, productCandidates, rankLinks, shopifyProducts, topColors, wooProducts,
  type PageData, type ScanProduct, type ScanResult,
} from './extract'

const MAX_PAGES = 28
const CATEGORY_PAGES = 5
const CONCURRENCY = 4
const MAX_PRODUCTS = 120

export class ScanError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
    this.name = 'ScanError'
  }
}

async function fetchText(url: string, accept?: string, maxBytes?: number): Promise<{ url: string; text: string; type: string } | null> {
  try {
    const res = await scanFetch(url, { accept, maxBytes, timeoutMs: 10_000 })
    if (res.status !== 200) return null
    return { url: res.url, text: res.body.toString('utf8'), type: res.contentType }
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetchText(url, 'application/json', 4 * 1024 * 1024)
  if (!r || !/json/.test(r.type)) return null
  try { return JSON.parse(r.text) } catch { return null }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, stopAt: number): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && Date.now() < stopAt) {
      const item = items[i++]
      await fn(item)
    }
  }))
}

/** Sitemap URLs that look like products (follows one level of sitemap index). */
async function sitemapProductUrls(origin: string, stopAt: number): Promise<string[]> {
  const robots = await fetchText(origin + '/robots.txt', 'text/plain', 256 * 1024)
  const declared = robots ? [...robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : []
  const roots = [...new Set([...declared, origin + '/sitemap.xml'])].slice(0, 3)
  const urls: string[] = []
  for (const root of roots) {
    if (Date.now() > stopAt) break
    const xml = await fetchText(root, 'application/xml,text/xml', 6 * 1024 * 1024)
    if (!xml) continue
    const parsed = parseSitemap(xml.text)
    urls.push(...parsed.urls)
    const children = parsed.sitemaps.filter(isProductSitemapUrl).concat(parsed.sitemaps.filter((s) => !isProductSitemapUrl(s))).slice(0, 2)
    for (const child of children) {
      if (Date.now() > stopAt) break
      const c = await fetchText(child, 'application/xml,text/xml', 6 * 1024 * 1024)
      if (c) urls.push(...parseSitemap(c.text).urls)
    }
    if (urls.length) break
  }
  return urls.filter((u) => u.startsWith(origin))
}

export async function scanStore(input: string, budgetMs = 45_000): Promise<ScanResult> {
  const stopAt = Date.now() + budgetMs
  const start = normalizeScanUrl(input)
  if (!start) throw new ScanError('Enter the address of a public website, e.g. mystore.com.', 400)

  let home: { url: string; text: string; type: string }
  try {
    const res = await scanFetch(start, { timeoutMs: 15_000 })
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) {
      throw new ScanError('The site doesn’t let scanners in (it answered ' + res.status + '). If it’s your store, its bot protection may be blocking us — book a consultation and we’ll move it for you.')
    }
    if (res.status >= 400) throw new ScanError(`The site answered with an error (${res.status}). Check the address.`)
    if (!/html/.test(res.contentType)) throw new ScanError('That address is not a web page.')
    home = { url: res.url, text: res.body.toString('utf8'), type: res.contentType }
  } catch (err) {
    if (err instanceof ScanError) throw err
    if (err instanceof ScanFetchError) throw new ScanError(err.message)
    const code = (err as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new ScanError('This address doesn’t exist. Check for typos.')
    throw new ScanError('We couldn’t reach the site. Check the address and try again.')
  }

  const origin = new URL(home.url).origin
  const homePage = extractPage(home.text, home.url)
  const platform = detectPlatform(home.text)
  const pages: PageData[] = [homePage]
  const lists: ScanProduct[][] = [homePage.products]
  let currency: string | null = null

  // 1) the platform's own public catalogue API, when there is one
  if (platform === 'shopify') {
    const json = await fetchJson(origin + '/products.json?limit=250')
    lists.push(shopifyProducts(json, origin))
    currency = home.text.match(/Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/)?.[1]
      ?? home.text.match(/"currency(?:Code)?"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null
  } else if (platform === 'woocommerce') {
    const json = await fetchJson(origin + '/wp-json/wc/store/v1/products?per_page=100')
    lists.push(wooProducts(json))
  }

  // 2) crawl. Product-looking URLs (sitemap or links) go first. Otherwise a few category pages
  //    are read, and the links they add to the home page's links are the product candidates.
  const productCount = () => mergeProducts(lists).length
  if (productCount() < 12 && Date.now() < stopAt) {
    const fromSitemap = await sitemapProductUrls(origin, stopAt - 15_000)
    const seen = new Set<string>([home.url, start.toString()])
    let fetched = 0
    const crawlStop = stopAt - 5_000
    const visit = async (url: string): Promise<PageData | null> => {
      if (seen.has(url) || fetched >= MAX_PAGES || productCount() >= MAX_PRODUCTS || Date.now() > crawlStop) return null
      seen.add(url)
      fetched++
      const page = await fetchText(url)
      if (!page || !/html/.test(page.type)) return null
      const data = extractPage(page.text, page.url)
      pages.push(data)
      lists.push(data.products)
      return data
    }
    const walk = async (urls: string[], limit: number) => {
      const list = urls.filter((u) => !seen.has(u)).slice(0, limit)
      const out: PageData[] = []
      await pool(list, CONCURRENCY, async (u) => { const d = await visit(u); if (d) out.push(d) }, crawlStop)
      return out
    }

    const ranked = rankLinks([...fromSitemap, ...homePage.links], origin)
    const productish = ranked.filter((u) => PRODUCT_PATH.test(new URL(u).pathname))
    await walk(productish, MAX_PAGES)
    if (productCount() < 12) {
      const menu = rankLinks(homePage.navLinks, origin).filter((u) => u !== home.url)
      const categories = await walk([...menu, ...ranked].filter((u) => !PRODUCT_PATH.test(new URL(u).pathname)), CATEGORY_PAGES)
      const candidates = productCandidates(homePage.links, categories.map((c) => c.links), origin)
      await walk(candidates, MAX_PAGES)
    }
  }

  // 3) look: colours and fonts from inline CSS + the first stylesheets
  let css = homePage.inlineCss
  for (const href of homePage.stylesheets.slice(0, 3)) {
    if (Date.now() > stopAt) break
    const sheet = await fetchText(href, 'text/css', 1_500_000)
    if (sheet) css += '\n' + sheet.text
  }
  const colors = topColors(css, homePage.themeColor)
  const fonts = [...new Set([...homePage.fonts, ...fontFamilies(css)])].slice(0, 4)

  const products = mergeProducts(lists).slice(0, MAX_PRODUCTS)
  const productImages = new Set(products.flatMap((p) => p.images))
  const siteImages = [
    ...(homePage.ogImage ? [{ src: homePage.ogImage, alt: '' }] : []),
    ...pages.flatMap((p) => p.images),
  ].filter((i, idx, arr) => !productImages.has(i.src) && i.src !== homePage.logo && arr.findIndex((x) => x.src === i.src) === idx)

  const allText = pages.map((p) => p.texts.join(' ')).join(' ')
  currency = currency
    ?? products.find((p) => p.currency)?.currency
    ?? homePage.currencyHint
    ?? (/Kč(?!\p{L})/u.test(allText) ? 'CZK' : null)

  return {
    url: home.url,
    platform,
    brand: {
      name: brandName(homePage),
      tagline: homePage.title.slice(0, 160),
      description: homePage.description.slice(0, 600),
      logo: homePage.logo,
    },
    language: homePage.lang || (currency === 'CZK' ? 'cs' : ''),
    currency,
    colors,
    fonts,
    nav: homePage.nav,
    headings: [...new Set(pages.slice(0, 4).flatMap((p) => p.headings))].slice(0, 24),
    texts: [...new Set(pages.slice(0, 4).flatMap((p) => p.texts))].slice(0, 24),
    products,
    images: siteImages.slice(0, 40),
    videos: [...new Set(pages.flatMap((p) => p.videos))].slice(0, 6),
    socials: homePage.socials,
    motion: [...new Set(pages.flatMap((p) => p.motion))],
    pagesScanned: pages.length,
  }
}
