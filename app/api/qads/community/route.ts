// GET /api/qads/community → { items } — the public Qads community wall: finished photos and videos
// people chose to share (lib/qads/community.ts). Public and read-only; cached at the edge for a few
// minutes (the signed URLs inside live for hours). Items without a light preview yet get one built
// after the response (lib/qads/community-preview.ts); until then the wall shows the original.
import { NextResponse, after } from 'next/server'
import { communityMedia } from '@/lib/qads/community'
import { buildCommunityPreviews } from '@/lib/qads/community-preview'

export const maxDuration = 120

export async function GET() {
  const { items, missing } = await communityMedia()
  if (missing.length) after(() => buildCommunityPreviews(missing))
  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  )
}
