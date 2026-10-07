// Shared state between <ParticleField> (root layout) and the <ParticleZone>s / <ParticleMode>s
// rendered anywhere below it. A module singleton, so it survives client navigation.

export type ParticleMode = 'off' | 'site' | 'app'

export interface ZoneRecord {
  id: number
  el: HTMLElement
  keys: string[]
  /** A priority zone (e.g. the open Qgent panel) wins over the zone nearest the viewport centre. */
  priority: boolean
}

type Listener = () => void

let seq = 0
const modes: { id: number; mode: ParticleMode }[] = []
let zones: ZoneRecord[] = []
const modeListeners = new Set<Listener>()
const zoneListeners = new Set<Listener>()

function emit(set: Set<Listener>) {
  set.forEach((fn) => fn())
}

// DOM order matters: the signal path on desktop runs from zone to zone in reading order.
function sortZones(list: ZoneRecord[]) {
  return list.slice().sort((a, b) => {
    if (a.el === b.el) return 0
    return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
}

export const particleStore = {
  /** The innermost mounted <ParticleMode> wins; returns the cleanup. */
  pushMode(mode: ParticleMode): () => void {
    const id = ++seq
    modes.push({ id, mode })
    emit(modeListeners)
    return () => {
      const i = modes.findIndex((m) => m.id === id)
      if (i >= 0) modes.splice(i, 1)
      emit(modeListeners)
    }
  },
  getMode(): ParticleMode {
    return modes.length ? modes[modes.length - 1].mode : 'off'
  },
  subscribeMode(fn: Listener): () => void {
    modeListeners.add(fn)
    return () => modeListeners.delete(fn)
  },

  addZone(el: HTMLElement, keys: string[], priority: boolean): () => void {
    const rec: ZoneRecord = { id: ++seq, el, keys, priority }
    zones = sortZones([...zones, rec])
    emit(zoneListeners)
    return () => {
      zones = zones.filter((z) => z.id !== rec.id)
      emit(zoneListeners)
    }
  },
  getZones(): ZoneRecord[] {
    return zones
  },
  subscribeZones(fn: Listener): () => void {
    zoneListeners.add(fn)
    return () => zoneListeners.delete(fn)
  },
}
