import { QuanteClerk } from '@/components/auth/QuanteClerk'
import { AppShell } from './AppShell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QuanteClerk>
      <AppShell>{children}</AppShell>
    </QuanteClerk>
  )
}
