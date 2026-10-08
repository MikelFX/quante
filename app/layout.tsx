import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { ParticleField } from '@ad/ui/particles'
import { ThemeScript } from '@ad/ui/ThemeScript'
import { adFontVars } from '@ad/ui/fonts'
import './globals.css'
import '@ad/ui/styles/app-tokens.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'latin-ext'],
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
      // AssetraDigital look through the --q-* tokens, so sign-in follows the theme too.
      appearance={{
        variables: {
          colorBackground: 'var(--q-s1)',
          colorText: 'var(--q-fg)',
          colorTextSecondary: 'var(--q-fg3)',
          colorPrimary: 'var(--q-acc)',
          colorTextOnPrimaryBackground: 'var(--q-acc-ink)',
          colorInputBackground: 'var(--q-bg)',
          colorInputText: 'var(--q-fg)',
          colorNeutral: 'var(--q-fg)',
          colorDanger: 'var(--q-danger-text)',
          colorSuccess: 'var(--q-ok-text)',
          borderRadius: '14px',
          fontFamily: 'var(--q-sans)',
          fontFamilyButtons: 'var(--q-sans)',
        },
        elements: {
          card: {
            background: 'linear-gradient(180deg, var(--q-glass1), var(--q-glass2)), var(--q-s1)',
            border: '1px solid var(--q-glass-border)',
            boxShadow: 'inset 0 1px 0 var(--q-glass-hi), 0 24px 60px -28px var(--q-shadow)',
            borderRadius: '28px',
          },
          headerTitle: { color: 'var(--q-fg)', fontWeight: '700' },
          headerSubtitle: { color: 'var(--q-fg3)' },
          socialButtonsBlockButton: {
            background: 'rgb(var(--q-ink-rgb) / .05)',
            border: '1px solid var(--q-line2)',
            color: 'var(--q-fg)',
            borderRadius: '999px',
            minHeight: '44px',
          },
          socialButtonsIconButton: { minHeight: '44px' },
          formFieldInput: {
            background: 'var(--q-bg)',
            border: '1px solid var(--q-line2)',
            color: 'var(--q-fg)',
            borderRadius: '16px',
            minHeight: '44px',
            '&::placeholder': { color: 'var(--q-fg4)' },
          },
          // Clerk derives these greys from the variables with colour math, which CSS variables
          // defeat — so each text element gets its token explicitly.
          formFieldLabel: { color: 'var(--q-fg2)' },
          formFieldHintText: { color: 'var(--q-fg3)' },
          formFieldInfoText: { color: 'var(--q-fg3)' },
          formFieldErrorText: { color: 'var(--q-danger-text)' },
          formFieldAction: { color: 'var(--q-acc-text)' },
          formResendCodeLink: { color: 'var(--q-acc-text)' },
          otpCodeFieldInput: { color: 'var(--q-fg)', borderColor: 'var(--q-line2)' },
          alternativeMethodsBlockButton: { color: 'var(--q-fg)', border: '1px solid var(--q-line2)' },
          headerBackLink: { color: 'var(--q-acc-text)' },
          alertText: { color: 'var(--q-fg)' },
          socialButtonsProviderIcon__github: { filter: 'var(--q-icon-invert)' },
          footer: { background: 'rgb(var(--q-ink-rgb) / .03)' },
          footerActionText: { color: 'var(--q-fg3)' },
          footerActionLink: { color: 'var(--q-acc-text)' },
          identityPreviewText: { color: 'var(--q-fg3)' },
          identityPreviewEditButton: { color: 'var(--q-acc-text)' },
          formButtonPrimary: {
            background: 'var(--q-acc)',
            color: 'var(--q-acc-ink)',
            borderRadius: '999px',
            minHeight: '44px',
          },
          dividerLine: { background: 'var(--q-line)' },
          dividerText: { color: 'var(--q-fg4)' },
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
        className={`${geistSans.variable} ${adFontVars} h-full`}
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
