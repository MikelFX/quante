import type { MetadataRoute } from 'next'

// Web app manifest (/manifest.webmanifest), linked from every page on both hosts. Its icons are the
// pixel-A tiles from scripts/brand-icons.py — what Android, Chrome and Google use for the brand.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AssetraDigital · Quante',
    short_name: 'Quante',
    description: 'AI řešení, software na míru a Quante — celý e-shop na jednom místě.',
    start_url: '/',
    display: 'browser',
    background_color: '#0b0a0c',
    theme_color: '#0b0a0c',
    icons: [
      { src: '/icon1.png', sizes: '96x96', type: 'image/png' },
      { src: '/icon2.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
