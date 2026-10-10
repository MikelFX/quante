import { QuanteClerk } from '@/components/auth/QuanteClerk'

// Sign-in uses Clerk on the client; the root layout does not load it (components/auth/QuanteClerk.tsx).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <QuanteClerk>{children}</QuanteClerk>
}
