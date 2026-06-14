'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface CartItem {
  id: string
  name: string
  price: number
  currency: string
  quantity: number
  image?: string
}

interface CartContextType {
  items: CartItem[]
  add: (item: Omit<CartItem, 'quantity'>) => void
  updateQty: (id: string, qty: number) => void
  remove: (id: string) => void
  clear: () => void
  count: number
  total: number
}

const CartContext = createContext<CartContextType>({
  items: [], add: () => {}, updateQty: () => {}, remove: () => {}, clear: () => {}, count: 0, total: 0,
})

export const useCart = () => useContext(CartContext)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    try {
      const s = localStorage.getItem('cart')
      if (s) setItems(JSON.parse(s))
    } catch {}
  }, [])

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(items))
  }, [items])

  function add(item: Omit<CartItem, 'quantity'>) {
    setItems((prev) => {
      const ex = prev.find((i) => i.id === item.id)
      if (ex) return prev.map((i) => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  function updateQty(id: string, qty: number) {
    if (qty <= 0) { setItems((prev) => prev.filter((i) => i.id !== id)); return }
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, quantity: qty } : i))
  }

  function remove(id: string) { setItems((prev) => prev.filter((i) => i.id !== id)) }
  function clear() { setItems([]) }

  const count = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0)

  return (
    <CartContext.Provider value={{ items, add, updateQty, remove, clear, count, total }}>
      {children}
    </CartContext.Provider>
  )
}
