import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { ParticleField } from '@ad/ui/particles'
import { ThemeScript } from '@ad/ui/ThemeScript'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'latin-ext'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Quante — AI E-commerce Builder',
  description: 'Describe your store. Quante builds it.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      afterSignOutUrl="/login"
      appearance={{
        variables: {
          colorBackground: '#101016',
          colorText: '#f4f4f6',
          colorPrimary: '#D4FF3F',
          colorInputBackground: '#0c0c12',
          colorInputText: '#f4f4f6',
          colorNeutral: '#8a8a93',
          colorDanger: '#f87171',
          borderRadius: '8px',
          fontFamily: 'var(--font-geist-sans)',
          fontFamilyButtons: 'var(--font-geist-sans)',
        },
        elements: {
          card: {
            background: '#101016',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
            borderRadius: '14px',
          },
          headerTitle: {
            color: '#f4f4f6',
            fontWeight: '700',
          },
          headerSubtitle: {
            color: '#8a8a93',
          },
          socialButtonsBlockButton: {
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#f4f4f6',
          },
          formFieldInput: {
            background: '#0c0c12',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#f4f4f6',
          },
          footerActionLink: {
            color: '#D4FF3F',
          },
          identityPreviewText: { color: '#8a8a93' },
          formButtonPrimary: {
            background: '#D4FF3F',
            color: '#fff',
          },
          dividerLine: { background: 'rgba(255,255,255,0.08)' },
          dividerText: { color: '#5b5b64' },
        },
      }}
    >
      {/* data-theme / data-motion drive the AssetraDigital surfaces. ThemeScript applies the saved
          choice before the first paint, so React keeps what it finds on <html>. */}
      <html
        lang="en"
        data-theme="dark"
        data-motion="on"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} h-full`}
      >
        <head>
          <ThemeScript />
        </head>
        <body className="min-h-full flex flex-col bg-background text-foreground">
          {/* One particle canvas for the whole app, so the swarm survives navigation. Idle until a
              <ParticleMode> (AssetraDigital pages) switches it on. */}
          <ParticleField />
          <AnnouncementBanner />
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
