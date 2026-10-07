'use client'

import { useState } from 'react'
import { Button } from '@ad/ui'

// Starts the Agency subscription checkout — the same POST /api/stripe/agency-checkout the old
// /pricing page used (it now redirects here). Signed-out visitors go to sign-in first.
export function AgencyCta() {
  const [state, setState] = useState<'' | 'loading'>('')
  const [msg, setMsg] = useState('')

  const start = async () => {
    if (state) return
    setState('loading')
    setMsg('')
    try {
      const res = await fetch('/api/stripe/agency-checkout', { method: 'POST' })
      if (res.status === 401) {
        window.location.href = '/login?redirect_url=' + encodeURIComponent('/quante#cenik')
        return
      }
      const data = (await res.json().catch(() => ({}))) as { url?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setMsg(
        res.status === 409 ? 'Agency už máte aktivní. Najdete ho v Billing.'
          : res.status === 503 ? 'Agency teď nejde objednat. Zkuste to prosím později.'
            : 'Platbu se nepodařilo otevřít. Zkuste to prosím znovu.',
      )
    } catch {
      setMsg('Platbu se nepodařilo otevřít. Zkuste to prosím znovu.')
    }
    setState('')
  }

  return (
    <div className="q-agency">
      <Button onClick={start} disabled={state === 'loading'}>{state === 'loading' ? 'Otevírám platbu…' : 'Objednat Agency'}</Button>
      <div aria-live="polite">{msg && <p className="frm-err" role="alert">{msg}</p>}</div>
    </div>
  )
}
