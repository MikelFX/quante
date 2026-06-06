import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
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
      afterSignOutUrl="/login"
      appearance={{
        variables: {
          colorBackground: '#101016',
          colorText: '#f4f4f6',
          colorPrimary: '#6f78e6',
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
            color: '#6f78e6',
          },
          identityPreviewText: { color: '#8a8a93' },
          formButtonPrimary: {
            background: '#6f78e6',
            color: '#fff',
          },
          dividerLine: { background: 'rgba(255,255,255,0.08)' },
          dividerText: { color: '#5b5b64' },
        },
      }}
    >
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full`}
      >
        <body className="min-h-full flex flex-col bg-background text-foreground">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
