'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { productLinks, quanteApp, quanteHome } from '@/content/assetra/modules'

/**
 * „Produkty“ in the floating nav (website and Quante pages): every Quante product with its page,
 * one line and its highlight (Qgent's 20 agents), plus the overview and the way into the app.
 * Desktop: a disclosure panel under the nav pill (click, Escape and a click outside close it).
 * Phone: ProductsMenuList at the top of the full-screen menu.
 */
export function ProductsMenu() {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div className="pm" ref={root} data-open={open ? '' : undefined}>
      <button ref={button} type="button" className="pm-b" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Produkty
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="pm-p glass" id={id} hidden={!open}>
        <p className="pm-k">Produkty Quante</p>
        <ul className="pm-g">
          {productLinks().map((p) => (
            <li key={p.slug}>
              <Link className={'pm-i' + (p.dev ? ' pm-dev' : '')} href={p.href} onClick={close}>
                <span className="pm-n">
                  {p.name}
                  {p.badge && <span className={'pm-t' + (p.slug === 'qgent' ? ' pm-hot' : '')}>{p.badge}</span>}
                </span>
                <span className="pm-s">{p.short}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="pm-f">
          <Link href={quanteHome()} onClick={close}>Celý Quante a jak moduly navazují →</Link>
          <a href={quanteApp.start} onClick={close}>Začít zdarma →</a>
        </div>
      </div>
    </div>
  )
}

/** The products at the top of the phone menu: compact, two columns, Qgent's highlight included. */
export function ProductsMenuList({ close }: { close: () => void }) {
  return (
    <nav className="pm-m" aria-label="Produkty">
      <p className="pm-k">Produkty</p>
      <ul>
        <li>
          <Link href={quanteHome()} onClick={close}><b>Quante</b><span className="pm-t">všechny</span></Link>
        </li>
        {productLinks().map((p) => (
          <li key={p.slug}>
            <Link href={p.href} onClick={close} className={p.dev ? 'pm-dev' : undefined}>
              <b>{p.name}</b>
              {p.badge && <span className={'pm-t' + (p.slug === 'qgent' ? ' pm-hot' : '')}>{p.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
