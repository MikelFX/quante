// /<INDEXNOW_KEY>.txt (next.config.ts rewrite): proves to IndexNow that we own the host.
import { indexNowKey } from '@/lib/agents/indexnow'

export function GET() {
  const key = indexNowKey(process.env)
  return key ? new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }) : new Response('Not found', { status: 404 })
}
