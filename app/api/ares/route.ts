import { NextResponse } from 'next/server'
import { lookupIco } from '@/lib/ares'
import { validateIco } from '@/lib/ico-validator'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ico = searchParams.get('ico')?.replace(/\s/g, '') ?? ''

  if (!validateIco(ico)) {
    return NextResponse.json({ error: 'Neplatné IČO' }, { status: 400 })
  }

  const result = await lookupIco(ico)
  if (!result) {
    return NextResponse.json({ error: 'IČO nebylo nalezeno v ARES' }, { status: 404 })
  }

  return NextResponse.json(result)
}
