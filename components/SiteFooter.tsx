import Link from 'next/link'
import { operator, socialLinks, footerNav } from '@/lib/site-config'

// Light/glass footer for the public site. Only rendered on public pages
// (never inside app/(app) — the Studio/dashboard has its own dark shell and
// doesn't import this component), so it's safe to hardcode the light
// palette here rather than reuse the dark tokens above.
const muted  = 'var(--qp-mut)'
const subtle = 'var(--qp-sub)'
const fg     = 'var(--qp-ink)'
const mono   = 'var(--qp-mono)'

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: '.10em', textTransform: 'uppercase', color: muted, marginBottom: 14 }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

function NavLink({ href, label, badge }: { href: string; label: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <Link href={href} style={{ fontSize: 13, color: subtle, textDecoration: 'none' }}>
        {label}
      </Link>
      {badge && (
        <span style={{
          fontFamily: mono, fontSize: 9, letterSpacing: '.06em',
          background: 'var(--qp-accent-wash)', color: 'var(--qp-accent-deep)',
          border: '1px solid rgba(212,255,63,.25)',
          padding: '1px 5px', borderRadius: 4,
        }}>
          {badge}
        </span>
      )}
    </div>
  )
}

// `TODO(michal):` prefix on any operator field means "not yet filled in" —
// the audit brief mandates a company block (QuanteCode s.r.o.) with the
// legal fields deferred to a real fill-in pass. Any TODO field is
// silently omitted from the rendered footer so a placeholder never leaks
// to the public site. Also detects the older "[TO FILL IN]" convention
// used in the previous config so an in-flight edit doesn't regress.
function isFilled(v: string | undefined | null): v is string {
  return !!v && !v.startsWith('TODO(michal)') && !v.includes('[TO')
}

export function SiteFooter() {
  const addressFilled = isFilled(operator.address)
  const icoFilled     = isFilled(operator.ico)
  const dicFilled     = isFilled(operator.dic)
  const emailFilled   = isFilled(operator.contactEmail)

  return (
    <footer style={{
      borderTop: '1px solid var(--qp-line-soft)',
      background: 'var(--qp-bg-alt)',
      padding: 'clamp(3rem,5vw,4rem) clamp(1.25rem,4vw,3rem)',
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* ── Brand + columns ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'auto repeat(3, 1fr)',
          gap: 'clamp(28px,4vw,56px)',
          alignItems: 'start',
          marginBottom: 40,
        }} className="footer-grid">
          {/* Brand */}
          <div>
            <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, color: fg, display: 'block', marginBottom: 8 }}>
              quante
            </span>
            <p style={{ fontSize: 12, color: muted, lineHeight: 1.6, maxWidth: 180 }}>
              AI-native e-commerce builder. Describe your store. We build it.
            </p>
          </div>

          {/* Product */}
          <Col title="Product">
            {footerNav.product.map(item => (
              <NavLink key={item.href} href={item.href} label={item.label} badge={'badge' in item ? item.badge : undefined} />
            ))}
          </Col>

          {/* Company */}
          <Col title="Company">
            {footerNav.company.map(item => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </Col>

          {/* Legal */}
          <Col title="Legal">
            {footerNav.legal.map(item => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </Col>
        </div>

        {/* ── Social icons ── */}
        {socialLinks.length > 0 && (
          <div style={{ display: 'flex', gap: 14, marginBottom: 28 }}>
            {socialLinks.map(s => (
              <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: muted, textDecoration: 'none' }}>
                {s.label}
              </a>
            ))}
          </div>
        )}

        {/* ── Legal entity block (Impressum) ──────────────────────────
           Company block first, then a secondary line naming the
           founder. Placeholder fields (still marked TODO(michal)) are
           silently dropped so an unfilled config never surfaces a
           "TODO" string to the public. */}
        <div style={{
          borderTop: '1px solid var(--qp-line-soft)',
          paddingTop: 24,
          marginBottom: 20,
        }}>
          <p style={{ fontSize: 11.5, color: subtle, lineHeight: 1.7, fontWeight: 500 }}>
            {operator.companyName}
          </p>
          <p style={{ fontSize: 11.5, color: muted, lineHeight: 1.7 }}>
            {operator.founderRole}: {operator.founderName}
          </p>
          {addressFilled && (
            <p style={{ fontSize: 11.5, color: muted, lineHeight: 1.7 }}>
              {operator.address}
            </p>
          )}
          {icoFilled && (
            <p style={{ fontSize: 11.5, color: muted, lineHeight: 1.7 }}>
              IČO: {operator.ico}
              {dicFilled && <> · DIČ: {operator.dic}</>}
            </p>
          )}
          {emailFilled && (
            <p style={{ fontSize: 11.5, color: muted, lineHeight: 1.7 }}>
              <a href={`mailto:${operator.contactEmail}`} style={{ color: muted, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {operator.contactEmail}
              </a>
            </p>
          )}
        </div>

        {/* ── Bottom bar ── */}
        <div style={{
          borderTop: '1px solid var(--qp-line-soft)',
          paddingTop: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <p style={{ fontSize: 11.5, color: muted, margin: 0 }}>
            © {new Date().getFullYear()} {operator.companyName}
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'Terms',   href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
              { label: 'Cookies', href: '/cookies' },
            ].map(l => (
              <Link key={l.href} href={l.href} style={{ fontSize: 11.5, color: muted, textDecoration: 'none' }}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>

      </div>
    </footer>
  )
}
