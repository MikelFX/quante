// English copy of the Quante modules for quantecode.com/en (owner 2026-11-07). Same facts as the
// Czech data in ./modules.ts — that file stays the source of truth for what ships (status, app
// entries, order); this one only translates the words. When a Czech line changes, change it here.

import type { ModuleSlug } from './modules'

export interface ModuleCopy {
  short: string
  tag: string
  badge?: string
  lead: string
  features: { title: string; text: string }[]
  note?: string
  /** the same hand-overs as the Czech module, in the same order */
  links: Partial<Record<ModuleSlug, string>>
  appLabel?: string
}

export const MODULES_EN: Record<ModuleSlug, ModuleCopy> = {
  generate: {
    short: 'A whole online store from a text brief.',
    tag: 'generator',
    lead: 'Describe your store and Quante builds it: it writes the store’s code, deploys it to Vercel and makes sure it builds.',
    features: [
      { title: 'Brief in a chat', text: 'Quante asks like a designer would: what you sell, to whom, what look you want and what you don’t. It turns your answers into a brief.' },
      { title: 'Code for every store', text: 'Pages and design are written for each store separately. The cart and checkout run on a proven core, so they always work.' },
      { title: 'Builds and fixes itself', text: 'The store gets a test build on Vercel. When the build fails, Quante reads the error, fixes the code and tries again, up to five times.' },
      { title: 'Changes in a sentence', text: 'Describe a change in the chat and Quante makes it.' },
      { title: 'Its own admin', text: 'Orders, products and customers. Payments through Comgate, GoPay or PayPal, shipping labels for Zásilkovna, GLS and DHL.' },
      { title: 'The code is yours', text: 'Download the whole project as a ZIP. You pay once per store; every later download is free.' },
    ],
    note: 'If a store still won’t build after five fixes, the generation credits come back. The fixes themselves are free.',
    links: {
      qscan: 'Qscan brings your existing store over by its address.',
      qdit: 'Fine-tune the details by hand, right on the page.',
      qads: 'Make ad photos and videos for the finished products.',
    },
    appLabel: 'Create a store',
  },
  qscan: {
    short: 'Turns your existing store, by its address, into a new and better store in Quante.',
    tag: 'scan',
    badge: 'New',
    lead: 'Enter the address of a store or website. Qscan takes its products, prices, photos, videos and copy, and Quante builds a new, far better-looking store from them.',
    features: [
      { title: 'Just the address', text: 'Shopify, WooCommerce, Shoptet or a plain website. Nothing to export by hand.' },
      { title: 'Products, photos, videos', text: 'It goes through the store and collects products with prices and variants, photos, videos, copy, colours and fonts.' },
      { title: 'Photos stored with us', text: 'Photos and videos are copied over to us, so the new store works even after you switch the old one off.' },
      { title: 'A new store in Quante', text: 'The scan becomes a regular Quante store that you keep editing in the Studio.' },
      { title: 'Hosting or code', text: 'Host the finished store with us monthly or yearly, or download its whole code.' },
    ],
    note: 'Only scan a store that is yours or whose content you may use. Videos embedded from YouTube and Vimeo are not copied. The scan is free; building the store costs the same as a regular generation.',
    links: {
      generate: 'Quante Generate builds the scanned store.',
      qdit: 'Make changes after the move in Qdit.',
      qgent: 'Qgent’s 20 agents review the old store, and the new one gets the suggestions you accepted.',
    },
    appLabel: 'Scan a store',
  },
  qgent: {
    short: '20 agents go through your store at once, suggest changes, or build a new one from it.',
    tag: '20 agents',
    badge: '20 agents',
    lead: 'Twenty agents go through your online store at once, layer by layer, suggest changes, and you pick the ones you want.',
    features: [
      { title: 'Just the address', text: 'Enter the store’s address and the agents read its home page and one product page. Nothing to install.' },
      { title: '20 specialists at once', text: 'Each agent watches something else: headings, copy, buttons, products, prices, shipping, trust, SEO, accessibility, mobile, speed and the legal minimum.' },
      { title: 'Live, layer by layer', text: 'Watch the agents go through the page layer by layer; suggestions appear as soon as they find them.' },
      { title: 'Yes or no', text: 'Accept or reject each suggestion. Nothing changes on your website and we store nothing.' },
      { title: 'A new store from the old one', text: 'From the address, the agents build a new store in Quante with the suggestions you accepted. You watch it being built part by part.' },
      { title: 'In the Studio for your store', text: 'For a store made in Quante, Qgent also reviews the code. It shows every change first, makes it only after you confirm, and it can be undone. It never changes payments, shipping or prices without a separate confirmation.' },
    ],
    note: 'Only send the agents to a store that is yours or whose content you may use. The code review for a Quante store is in the Studio, in “Qgent” mode. On the AssetraDigital website, Qgent also answers visitors’ questions.',
    links: {
      qscan: 'A new store from the old one is built on top of a Qscan scan.',
      generate: 'Quante Generate builds the new store with the accepted suggestions.',
      qdit: 'Instead of confirming a suggestion, you can make the change by hand in Qdit.',
      qads: 'It hands what it learned about your store to Qads for ads.',
    },
    appLabel: 'Send 20 agents',
  },
  qdit: {
    short: 'Edit by hand, right on the page: click, rewrite, move.',
    tag: 'editor',
    lead: 'Edit by hand, right on the page. Click a text and rewrite it, move or delete elements. Use AI only when you want to.',
    features: [
      { title: 'Click and rewrite', text: 'Double-click any text in the store’s live preview to edit it.' },
      { title: 'Design per device', text: 'Fonts, colours, layout, spacing and borders, separately for desktop, tablet and phone.' },
      { title: 'Move, add, delete', text: 'Move elements up or down, add a button, heading, text or image.' },
      { title: 'AI on request', text: 'Ask Quante about the selected element or let AI create a new one.' },
      { title: 'Nothing breaks for shoppers', text: 'Edits are saved as a draft. Shoppers see them only after you click Publish.' },
      { title: 'Protected parts', text: 'The editor never touches the cart, checkout or legal pages, so the store always works.' },
    ],
    note: 'You’ll find the editor in the Studio of every store under “Edit visually”. It works on a computer.',
    links: {
      generate: 'You edit a store that Quante Generate built.',
      qgent: 'Qgent suggests the edits for you.',
    },
    appLabel: 'Open Quante',
  },
  qads: {
    short: 'Ad videos and photos for your store, ready to download.',
    tag: 'ads',
    badge: 'New',
    lead: 'Ad photos and videos from photos of your product. Download the finished files and use them wherever you like.',
    features: [
      { title: 'From a product photo', text: 'Upload one to four photos of the product and write its name and a short description.' },
      { title: 'Formats for social', text: '9:16, 4:5, 1:1 and 16:9, up to four variants of each format.' },
      { title: 'Five styles', text: 'Packshot, lifestyle, UGC, cinematic and minimal.' },
      { title: '1080p videos, 4 to 30 seconds', text: 'Sharp videos for ads and stories.' },
      { title: 'Character', text: 'Create an AI character that talks about your product in a 10 or 15 second vertical video, with voice and lip sync. AI writes the script from the product photo.' },
      { title: 'Ad copy', text: 'Hook, body, headline, call to action, script and captions. In Czech, Slovak, English or German.' },
      { title: 'Ready to download', text: 'Each file separately or everything as a ZIP. Qads publishes nothing; where your ads go is up to you.' },
    ],
    note: 'Photos and videos are made with Higgsfield. Credits are paid up front and come back for items that fail.',
    links: {
      generate: 'Ads for the products of a store Quante Generate built.',
      qgent: 'Qgent hands Qads what it knows about your store.',
    },
    appLabel: 'Open Qads',
  },
  qails: {
    short: 'The e-mail of all your stores in one place.',
    tag: 'e-mail',
    lead: 'The e-mail of all your stores in one place, sorted by store.',
    features: [
      { title: 'One inbox', text: 'Orders, questions and complaints from every store together.' },
      { title: 'By store', text: 'Every message shows the store it belongs to.' },
      { title: 'Search across stores', text: 'One search goes through the e-mail of every store.' },
    ],
    note: 'Qails is in development and we don’t give a date yet.',
    links: {
      generate: 'E-mail of the stores Quante Generate built.',
      qgent: 'Qgent will also know what your customers ask about.',
    },
  },
}

export const QUANTE_INTRO_EN = {
  sub: 'Your whole online store in one place: generate, edit, promote and run it.',
}

export const QUANTE_FLOW_EN: Record<ModuleSlug, { title: string; text: string }> = {
  qscan: { title: 'Move', text: 'Qscan brings your existing store over by its address.' },
  generate: { title: 'Build', text: 'Quante Generate builds the store from a brief and makes sure it builds.' },
  qdit: { title: 'Fine-tune', text: 'In Qdit you edit copy, look and layout right on the page.' },
  qgent: { title: 'Review', text: 'Qgent’s twenty agents go through the store layer by layer, and you accept the suggestions you want.' },
  qads: { title: 'Promote', text: 'Qads makes ad photos and videos ready to download.' },
  qails: { title: 'Talk', text: 'Qails brings the e-mail of all your stores into one place.' },
}

export const QUANTE_START_EN = {
  title: 'What do you want to do first?',
  sub: 'Pick a goal and Quante takes you straight to the right product with the brief filled in.',
  goals: {
    ads: { title: 'Ads for a product', text: 'Ad videos and photos, an AI creator who presents the product, or a 30-day plan.' },
    scan: { title: 'Move my store', text: 'Enter the address and Qscan builds a new store from its products, photos and copy.' },
    new: { title: 'A new store', text: 'Describe what you sell and Quante builds the whole store, checkout included.' },
    qgent: { title: 'Review my store', text: 'Enter the address and 20 agents go through it layer by layer. Accept or reject their suggestions.' },
  } as Record<string, { title: string; text: string }>,
}

const EN_LIVE = ['No module works yet', 'One module works', 'Two modules work', 'Three modules work', 'Four modules work', 'Five modules work', 'Six modules work']

/** "Five modules work and you can use them today. Qails is in development." */
export function statusLineEn(live: number, dev: string[]): string {
  const devText = !dev.length ? '' : dev.length === 1 ? ` ${dev[0]} is in development.` : ` ${dev.slice(0, -1).join(', ')} and ${dev[dev.length - 1]} are in development.`
  return `${EN_LIVE[live] ?? `${live} modules work`}${live ? ` and you can use ${live === 1 ? 'it' : 'them'} today.` : '.'}${devText}`
}
