import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

// Server-safe building blocks. Class names are the design's own (.btn, .glass, .lbl …) and are
// styled by styles/assetra.css under the .ad scope.

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** Delay for a .rv / .ttl entrance animation, in seconds. */
export function delay(s?: number): CSSProperties | undefined {
  return s ? { animationDelay: s + 's' } : undefined
}

/** In-page anchors stay plain <a>; routes go through next/link. */
export function SmartLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  if (href.startsWith('#') || /^(https?:|mailto:|tel:)/.test(href)) {
    return <a href={href} className={className} {...rest}>{children}</a>
  }
  return <Link href={href} className={className} {...rest}>{children}</Link>
}

/** The AD mark: A and D share one vertical stroke; the mint pixel inside the A blinks. */
export function AdMark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 32" aria-hidden="true">
      <path d="M3 29 L20 3 L20 29 M20 3 H25 A13 13 0 0 1 25 29 H20" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter" />
      <rect className="px" x="12.6" y="18.2" width="4.6" height="4.6" />
    </svg>
  )
}

export function Logo({ href = '/', label = 'Assetra Digital, úvod' }: { href?: string; label?: string }) {
  return (
    <SmartLink className="logo" href={href} aria-label={label}>
      <AdMark />
      <span className="wm">Assetra<br />Digital</span>
    </SmartLink>
  )
}

export interface ButtonProps {
  children: string
  href?: string
  variant?: 'pri' | 'gl' | 'plain'
  /** Light running around the edge. */
  beam?: boolean
  /** Follows the pointer slightly (fine pointers only). */
  magnetic?: boolean
  arrow?: boolean
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
  onClick?: () => void
}

/** Pill button; the label rolls up on hover. */
export function Button({ children, href, variant = 'gl', beam, magnetic = true, arrow, type = 'button', className, disabled, onClick }: ButtonProps) {
  const cls = cx('btn', variant !== 'plain' && variant, beam && 'beam', magnetic && 'mag', className)
  const inner = (
    <>
      <span className="t"><span>{children}</span><span aria-hidden="true">{children}</span></span>
      {arrow && <i className="ar" aria-hidden="true">↗</i>}
    </>
  )
  if (href) return <SmartLink href={href} className={cls} onClick={onClick}>{inner}</SmartLink>
  return <button type={type} className={cls} disabled={disabled} onClick={onClick}>{inner}</button>
}

/** Glass card with the pointer spotlight; span = columns of the 12-column bento grid. */
export function Card({ children, span, className, reveal, delaySec, as: Tag = 'article' }: { children: ReactNode; span?: 5 | 7 | 12; className?: string; reveal?: boolean; delaySec?: number; as?: 'article' | 'div' }) {
  return (
    <Tag className={cx('card glass spot', span === 5 && 'w5', span === 7 && 'w7', reveal && 'rv', className)} style={delay(delaySec)}>
      {children}
    </Tag>
  )
}

/** 01 SLUŽBY — the mint-ruled section label. */
export function SectionLabel({ num, children, reveal = true }: { num: string; children: ReactNode; reveal?: boolean }) {
  return <span className={cx('lbl', reveal && 'rv')}><b>{num}</b>{children}</span>
}

/** Giant uppercase headline revealed with a clip-path when its section scrolls in. */
export function SectionTitle({ children, as: Tag = 'h2', className = 'h2' }: { children: ReactNode; as?: 'h1' | 'h2' | 'h3'; className?: string }) {
  return <Tag className={cx(className, 'ttl')}>{children}</Tag>
}

export function Sub({ children, delaySec = 0.1 }: { children: ReactNode; delaySec?: number }) {
  return <p className="sub rv" style={delay(delaySec)}>{children}</p>
}

/** Visible placeholder for data we do not have yet — never invent it. */
export function Todo({ children }: { children: ReactNode }) {
  return <span className="todo">{children}</span>
}

export function Pill({ badge, children }: { badge: string; children: ReactNode }) {
  return <span className="pill glass"><b>{badge}</b>{children}</span>
}

export function CheckList({ items, className, delaySec }: { items: string[]; className?: string; delaySec?: number }) {
  return (
    <ul className={cx('checks', className)} style={delay(delaySec)}>
      {items.map((t) => <li key={t} className="glass"><i aria-hidden="true">✓</i>{t}</li>)}
    </ul>
  )
}

/** Hero headline: letters fall in one by one, width collapsing from 125 % to 66 %. */
export function CharHeading({ text, className = 'h1', start = 0.12, step = 0.022, highlight = [] }: { text: string; className?: string; start?: number; step?: number; highlight?: string[] }) {
  let n = 0
  return (
    <h1 className={className} aria-label={text}>
      {text.split(' ').map((word, wi) => (
        <span className="wd" aria-hidden="true" key={wi}>
          {word.split('').map((ch, ci) => (
            <span key={ci} className={highlight.includes(word) ? 'c hl' : 'c'} style={{ animationDelay: (start + n++ * step).toFixed(3) + 's' }}>{ch}</span>
          ))}
        </span>
      ))}
    </h1>
  )
}
