import { QuanteClerk } from '@/components/auth/QuanteClerk'

// The onboarding wizard knows whether the visitor is signed in (Clerk on the client); the root
// layout does not load Clerk (components/auth/QuanteClerk.tsx).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <QuanteClerk>{children}</QuanteClerk>
}
