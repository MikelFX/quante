import { QuanteClerk } from '@/components/auth/QuanteClerk'

// The merchant account signs in with the same account as Quante (Clerk on the client only here).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <QuanteClerk>{children}</QuanteClerk>
}
