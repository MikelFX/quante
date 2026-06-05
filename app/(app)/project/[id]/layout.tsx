// Studio needs to manage its own scroll/height — tell the parent not to clip it.
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden flex flex-col">{children}</div>
}
