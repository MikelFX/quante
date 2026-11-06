import { QuanteClerk } from '@/components/auth/QuanteClerk'

// Agent-ready stores (the public nav) uses Clerk on the client; the root layout does not load it (components/auth/QuanteClerk.tsx).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <QuanteClerk>{children}</QuanteClerk>
}
