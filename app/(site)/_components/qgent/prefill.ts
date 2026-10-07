// Hand-off from the Qgent panel to the homepage lead form. Used only after the visitor clicked
// „Vyplnit formulář“ in the panel. The form may not be mounted yet (another page), so the values
// also wait in sessionStorage until <LeadForm> picks them up. Nothing is sent anywhere — the
// visitor still submits the form themselves.

export const PREFILL_EVENT = 'qgent:prefill-lead'
const KEY = 'qgent-prefill'

export interface LeadPrefill {
  jmeno: string
  kontakt: string
  potreba: string
}

export function offerPrefill(p: LeadPrefill) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p))
  } catch {}
  window.dispatchEvent(new CustomEvent<LeadPrefill>(PREFILL_EVENT, { detail: p }))
}

/** Reads and clears a waiting prefill. */
export function takePrefill(): LeadPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const v = JSON.parse(raw) as Partial<LeadPrefill>
    return { jmeno: String(v.jmeno ?? ''), kontakt: String(v.kontakt ?? ''), potreba: String(v.potreba ?? '') }
  } catch {
    return null
  }
}

export function clearPrefill() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {}
}
