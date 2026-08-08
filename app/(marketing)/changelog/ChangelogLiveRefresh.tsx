'use client'

// V2 real-time changelog — the "user already has the tab open" case.
//
// The server side (page.tsx) is now `dynamic = 'force-dynamic'`, so every fresh
// request already gets live data straight from Supabase. That alone does nothing
// for someone who published /changelog five minutes ago in another tab: React
// Server Components don't push updates to an already-rendered page. This is the
// small client island that closes that gap with a plain `router.refresh()` poll —
// which re-runs the server component and swaps in new data without a full reload
// or any visible flash for the (common) case where nothing changed.
//
// Why polling instead of Supabase Realtime: Realtime would need the table added to
// the realtime publication and a new RLS SELECT policy for the anon role (today
// anon correctly gets 0 rows — see scripts/check-changelog.ts check #3). That's a
// schema/security change for a low-traffic marketing page publishing a handful of
// entries a month. A 45s poll, paused whenever the tab isn't visible, gets the same
// user-facing outcome — "new entry appears without a manual refresh" — with zero
// DB/schema changes and about ten lines of code.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const REFRESH_INTERVAL_MS = 45_000

export function ChangelogLiveRefresh() {
  const router = useRouter()

  useEffect(() => {
    const tick = () => {
      // Skip refreshing a backgrounded tab — no visible benefit, just wasted requests.
      if (document.visibilityState === 'visible') {
        router.refresh()
      }
    }

    const id = window.setInterval(tick, REFRESH_INTERVAL_MS)

    // Also refresh immediately when the tab regains focus/visibility, so switching
    // back to an old tab feels current without waiting for the next tick.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [router])

  return null
}
