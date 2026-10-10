// GET /api/qads/community → { items } — the public Qads community wall: finished photos and videos
// people chose to share (lib/qads/community.ts). Public and read-only; cached at the edge for a few
// minutes (the signed URLs inside live for hours).
import { NextResponse } from 'next/server'
import { communityMedia } from '@/lib/qads/community'

export async function GET() {
  const items = await communityMedia()
  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  )
}
