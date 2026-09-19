// Pricing FAQ — single source rendered by /pricing AND used by the
// Phase 3 FAQPage JSON-LD schema, so a question and its answer never
// diverge between the human page and the search-engine version.
//
// Any number in an answer is pulled from lib/pricing helpers rather
// than typed — a $9.99 or "5 credits" that lives here must be a
// helper call. That keeps the audit brief's "single source of truth"
// property intact: change lib/config.ts CREDIT_COSTS or the pack
// ladder, and every visible surface updates in lock step.

import {
  formatHostingAnnual,
  formatHostingMonthly,
  formatHostingBoth,
  CREDIT_COSTS,
} from './pricing'

export interface FaqItem {
  q: string
  a: string
}

export const PRICING_FAQ: FaqItem[] = [
  {
    q: 'Do credits expire?',
    a: 'No. Credits never expire. Buy once and use them whenever you feel like it.',
  },
  {
    q: 'What if something goes wrong during generation?',
    a: "Credits are only taken on success. If a generation fails and we can't auto-fix it, nothing is charged.",
  },
  {
    q: 'Can I export the same store more than once?',
    a: 'Yes — export is free. Every export downloads a complete Next.js project you own outright, and you can re-export whenever you want.',
  },
  {
    q: 'What does "Deploy to Quante hosting" mean?',
    a: `One click in the Studio and your store goes live on a URL like my-store.stores.quantecode.com — SSL, CDN and subdomain included, no server setup. Deploys and re-deploys are included in your hosting plan; ${CREDIT_COSTS.deploy === 0 ? 'no credits are charged per deploy' : `${CREDIT_COSTS.deploy} credits per deploy`}.`,
  },
  {
    q: 'Can I self-host instead?',
    a: 'Yes. Export the ZIP (free) and deploy anywhere — Vercel\'s free Hobby plan, Railway, Fly.io, your own VPS. The ZIP is a plain Next.js project with zero Quante dependency. No hosting plan needed.',
  },
  {
    q: 'Do I need a subscription to build a store?',
    a: `No. You only pay for credits when you actually generate or iterate — no monthly fee to keep an account, no subscription to build. Hosting on Quante is optional (${formatHostingBoth()}); if you'd rather host it yourself, export the ZIP and go.`,
  },
  {
    q: 'What does the hosting plan cover?',
    a: `${formatHostingAnnual()} annually or ${formatHostingMonthly()} monthly buys managed hosting, automatic SSL renewal, a quantecode.com subdomain (or your own custom domain via CNAME), global CDN, uptime monitoring, and unlimited deploys — no per-deploy credit cost while your plan is active.`,
  },
  {
    q: 'What happens if my hosting expires?',
    a: 'Your store is paused and visitors see a maintenance page — nothing is ever deleted. Your products, orders and design are kept safe for at least 90 days. Resubscribe and your store goes back online automatically.',
  },
]
