// The first pieces on the Qads community wall (app/qads/QadsCommunityWall.tsx), so it is never
// empty: ads made with Qads, supplied by the owner (2026-10-10). Files in public/qads/community/
// (photos converted to WebP; videos as delivered, each with a poster frame). Shared creations from
// users come first and these fill the rest (lib/qads/community.ts → /api/qads/community).
// A video of a prescription-only medicine was left out on purpose: advertising Rx medicines to the
// general public is not allowed in the Czech Republic. The preroll and lighter pieces were taken
// down at the owner's request (2026-10-28).

export interface WallMedia {
  id: string
  kind: 'image' | 'video'
  src: string
  /** Still frame shown before a video loads. */
  poster?: string
  /** Shown on hover and as the accessible name. */
  label: string
}

const P = '/qads/community/'

export const COMMUNITY_SEED: WallMedia[] = [
  { id: 'seed-v-keyboard', kind: 'video', src: P + 'video-keyboard.mp4', poster: P + 'video-keyboard.webp', label: 'Cinematic video · 9:16' },
  { id: 'seed-p-keyboard', kind: 'image', src: P + 'photo-keyboard.webp', label: 'Cinematic photo · 9:16' },
  { id: 'seed-v-wheel', kind: 'video', src: P + 'video-wheel.mp4', poster: P + 'video-wheel.webp', label: 'Studio video · 9:16' },
]
