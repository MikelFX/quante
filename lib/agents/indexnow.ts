// IndexNow (Bing, Yandex, Seznam, Naver …; Bing feeds Copilot and ChatGPT search): we tell the
// search engines our pages exist instead of waiting to be crawled. Off until INDEXNOW_KEY is set
// (8–128 letters, digits or dashes); the key file is served at /<key>.txt on both hosts
// (next.config.ts rewrite → /api/agent/indexnow-key). The weekly cron /api/cron/indexnow submits.
import { APP_ORIGIN, SITE_ORIGIN } from '@/lib/domains'
import { agentPages } from './pages'
import { AGENT_LINKS, RUNTIME_OFF } from './catalog'

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

export function indexNowKey(env: Record<string, string | undefined>): string | null {
  const k = env.INDEXNOW_KEY?.trim() ?? ''
  return /^[A-Za-z0-9-]{8,128}$/.test(k) ? k : null
}

/** One submission per host (IndexNow wants every URL on the key's host). */
export function indexNowPayloads(key: string) {
  const pages = agentPages(RUNTIME_OFF)
  const urls = [
    ...pages.flatMap((p) => [p.url, p.md]),
    `${SITE_ORIGIN}/llms.txt`, `${APP_ORIGIN}/llms.txt`, AGENT_LINKS.llmsFull, AGENT_LINKS.catalog,
    `${APP_ORIGIN}/qads`, `${APP_ORIGIN}/qscan`, `${APP_ORIGIN}/qgent`, `${APP_ORIGIN}/qbox`, `${APP_ORIGIN}/changelog`,
  ]
  return [SITE_ORIGIN, APP_ORIGIN].map((origin) => ({
    host: new URL(origin).host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList: [...new Set(urls.filter((u) => u.startsWith(origin + '/')))],
  })).filter((p) => p.urlList.length)
}
