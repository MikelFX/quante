'use client'

import type { ReactNode } from 'react'
import { CartProvider } from '@/context/cart'
import { CartDrawer } from './CartDrawer'

interface Props {
  children: ReactNode
  basePath: string
  currency?: string
}

export function StoreShell({ children, basePath, currency }: Props) {
  return (
    <CartProvider>
      {children}
      <CartDrawer basePath={basePath} currency={currency} />
    </CartProvider>
  )
}
