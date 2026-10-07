import 'server-only'
import { checkBotId } from 'botid/server'

/**
 * Vercel BotID verdict for the public AssetraDigital endpoints (/api/leads, /api/qgent/public;
 * the browser side is instrumentation-client.ts). If the check itself fails — e.g. outside Vercel,
 * or the project has no OIDC token — the request goes through and the error is logged: losing a
 * real lead is worse than one unchecked request, and both routes keep their own rate limits.
 */
export async function isBot(tag: string): Promise<boolean> {
  try {
    return (await checkBotId()).isBot
  } catch (err) {
    console.error(`[${tag}] BotID check failed, request allowed:`, err instanceof Error ? err.message : err)
    return false
  }
}
