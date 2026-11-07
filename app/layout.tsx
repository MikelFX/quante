import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { ParticleField } from '@ad/ui/particles'
import { ThemeScript } from '@ad/ui/ThemeScript'
import { adFontVars } from '@ad/ui/fonts'
import { LANG_SCRIPT } from '@/lib/lang-script'
import './globals.css'
import '@ad/ui/styles/app-tokens.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'latin-ext'],
})

export const metadata: Metadata = {
  title: 'Quante — AI E-commerce Builder',
  description: 'Describe your store. Quante builds it.',
  applicationName: 'Quante',
  // Icons are files: app/favicon.ico (16/32/48), icon.svg, icon1.png (96), icon2.png (192),
  // apple-icon.png (180) and app/manifest.ts — all from scripts/brand-icons.py. Google picks the
  // search-result icon from these (a multiple of 48 px, square).
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // data-theme / data-motion drive the AssetraDigital surfaces. ThemeScript applies the saved
  // choice before the first paint, so React keeps what it finds on <html>. Clerk is not here:
  // only the Quante app layouts load it (components/auth/QuanteClerk.tsx).
  return (
    <html
      lang="en"
      data-theme="dark"
      data-motion="on"
      suppressHydrationWarning
      className={`${geistSans.variable} ${adFontVars} h-full`}
    >
      <head>
        <ThemeScript />
        {/* lang of this page (cs website + Quante pages, en app and /en): lib/lang-script.ts */}
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* The particle engine and the website's background canvas, here so they survive navigation.
            Idle until a <ParticleMode> (AssetraDigital pages) switches it on. */}
        <ParticleField />
        <AnnouncementBanner />
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
