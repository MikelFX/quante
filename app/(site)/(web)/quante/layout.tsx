/** Quante's pages keep Quante's green accents inside the magenta website (site.css, .ad-q). */
export default function QuanteLayout({ children }: { children: React.ReactNode }) {
  return <div className="ad-q">{children}</div>
}
