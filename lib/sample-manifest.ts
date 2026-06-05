import type { ShopManifest } from '@/types/manifest'

export const AURA_MANIFEST: ShopManifest = {
  version: '1',
  brand: {
    name: 'Aura',
    tagline: 'Skin that speaks for itself.',
    voice: 'minimal',
    logoText: 'AURA',
  },
  design: {
    palette: {
      bg: '#FAFAF8',
      surface: '#F2F2EC',
      text: '#1A1A18',
      muted: '#888884',
      accent: '#C9A96E',
      accentText: '#FFFFFF',
      border: '#E4E4DC',
    },
    typography: {
      headingFont: 'Playfair Display',
      bodyFont: 'DM Sans',
      scale: 'comfortable',
    },
    radius: 'sm',
    density: 'airy',
    motion: 'subtle',
  },
  catalog: {
    currency: 'EUR',
    products: [
      {
        id: 'p1',
        name: 'Radiance Serum',
        description: 'A lightweight vitamin C serum that brightens and evens skin tone over time.',
        price: 68,
        images: [],
        slug: 'radiance-serum',
        available: true,
        tags: ['bestseller', 'serum'],
      },
      {
        id: 'p2',
        name: 'Dew Moisturiser',
        description: 'Deep hydration for all skin types. Fragrance-free, dermatologist tested.',
        price: 52,
        images: [],
        slug: 'dew-moisturiser',
        available: true,
        tags: ['moisturiser'],
      },
      {
        id: 'p3',
        name: 'Gentle Cleanser',
        description: "Removes impurities without stripping the skin's natural moisture barrier.",
        price: 38,
        images: [],
        slug: 'gentle-cleanser',
        available: true,
        tags: ['cleanser'],
      },
      {
        id: 'p4',
        name: 'Night Repair Oil',
        description: 'A blend of botanical oils that work overnight to restore and nourish.',
        price: 74,
        images: [],
        slug: 'night-repair-oil',
        available: true,
        tags: ['oil', 'night'],
      },
    ],
    collections: [
      {
        id: 'c1',
        name: 'The Essentials',
        slug: 'essentials',
        description: 'The four-step ritual for healthy skin.',
        productIds: ['p1', 'p2', 'p3', 'p4'],
      },
    ],
  },
  pages: {
    home: [
      {
        type: 'hero',
        props: {
          headline: 'Skin that speaks\nfor itself.',
          subheadline:
            'Minimal formulas. Maximum results. Crafted for skin that wants to be itself.',
          ctaLabel: 'Shop the ritual',
          ctaHref: '/collections/essentials',
          secondaryCtaLabel: 'Learn more',
          secondaryCtaHref: '/about',
          layout: 'centered',
        },
      },
      {
        type: 'productGrid',
        props: {
          title: 'The Ritual',
          collectionId: 'c1',
          columns: 4,
        },
      },
      {
        type: 'featureRow',
        props: {
          title: 'Why Aura',
          features: [
            {
              icon: 'leaf',
              title: 'Clean formulas',
              description:
                'Every ingredient earns its place. No fillers, no fragrance, no compromise.',
            },
            {
              icon: 'flask',
              title: 'Lab tested',
              description:
                'Dermatologist tested and clinically proven. Backed by science.',
            },
            {
              icon: 'recycle',
              title: 'Sustainable packaging',
              description:
                'Refillable glass, recycled paper, zero single-use plastic.',
            },
          ],
          layout: 'grid',
        },
      },
      {
        type: 'testimonials',
        props: {
          title: 'What our customers say',
          items: [
            {
              quote:
                'After two weeks of the Radiance Serum my skin has never looked so even. I get compliments now.',
              author: 'Martina K.',
              role: 'Verified buyer',
            },
            {
              quote:
                "The Dew Moisturiser is the first moisturiser that doesn't pill under makeup. Changed my morning routine completely.",
              author: 'Sofie R.',
              role: 'Verified buyer',
            },
            {
              quote:
                'I appreciate that the ingredient lists are actually readable. Clean, effective, simple.',
              author: 'Lukas B.',
              role: 'Verified buyer',
            },
          ],
        },
      },
      {
        type: 'newsletter',
        props: {
          title: 'Join the ritual',
          description:
            'New formulas, skincare notes, and early access for our community.',
          placeholder: 'your@email.com',
          buttonLabel: 'Subscribe',
        },
      },
    ],
    product: [
      {
        type: 'richText',
        props: { content: 'Product details coming soon.', align: 'left' },
      },
    ],
    collection: [
      {
        type: 'productGrid',
        props: { columns: 3 },
      },
    ],
    about: [
      {
        type: 'richText',
        props: {
          content:
            'Aura was born from a simple frustration: too many skincare brands with too many products, too many promises, and not enough proof.\n\nWe make four things. Each one does exactly what it says. Every formula is fragrance-free, clinically tested, and built to work with your skin — not against it.\n\nThat\'s it.',
          align: 'center',
        },
      },
    ],
  },
  nav: [
    { label: 'Shop', href: '/collections/essentials' },
    { label: 'About', href: '/about' },
  ],
  footer: {
    columns: [
      {
        title: 'Aura',
        links: [
          { label: 'About us', href: '/about' },
          { label: 'Ingredients', href: '/ingredients' },
          { label: 'Sustainability', href: '/sustainability' },
        ],
      },
      {
        title: 'Support',
        links: [
          { label: 'FAQ', href: '/faq' },
          { label: 'Contact', href: '/contact' },
          { label: 'Returns', href: '/returns' },
        ],
      },
    ],
    legal: '© 2026 Aura Skincare. All rights reserved.',
    socials: [{ platform: 'instagram', url: 'https://instagram.com/auraskincare' }],
  },
  seo: {
    title: 'Aura — Minimal Skincare',
    description: 'Clean, effective skincare. Formulated for real skin.',
  },
}
