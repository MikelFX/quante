import type { Metadata } from 'next'
import { PnFoot, PnTop } from '../_chrome'
import { AccountClient } from './AccountClient'
import '../plnolet.css'

export const metadata: Metadata = { title: 'Účet · Plnolet', robots: { index: false, follow: false } }

export default function AccountPage() {
  return (
    <div className="pn">
      <PnTop />
      <main className="pn-main"><AccountClient /></main>
      <PnFoot />
    </div>
  )
}
