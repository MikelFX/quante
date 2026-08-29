// Shared, reference-counted body-scroll lock for the storefront preview renderer.
//
// Why this exists: CartDrawer, StoreNavbar (mobile menu), and ProductGallery
// (lightbox) each used to set `document.body.style.overflow` directly and
// independently. That's fine in isolation, but the moment two of them are
// open at once (e.g. the cart is open and the user also opens the mobile
// menu, or a lightbox is left mounted), whichever one closes LAST wins and
// stomps on the other's lock — in the worst ordering, closing everything
// still leaves `overflow: hidden` stuck on <body> forever, because nothing
// else ever sets it back. A plain boolean toggle can't express "2 things
// currently want this locked." A count can.
let lockCount = 0

export function lockScroll(): void {
  lockCount += 1
  if (lockCount === 1) {
    document.body.style.overflow = 'hidden'
  }
}

export function unlockScroll(): void {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = ''
  }
}

// Convenience hook-friendly helper: call from a `useEffect(() => {...}, [open])`
// and return the returned cleanup function. Locks when `open` is true, and
// guarantees the lock is released (decremented) on close OR unmount — the
// two failure modes that caused the stuck-scroll bug this replaces.
export function useScrollLockEffect(open: boolean): () => void {
  if (open) lockScroll()
  return () => {
    if (open) unlockScroll()
  }
}
