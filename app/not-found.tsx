import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-6">
      <p className="font-mono text-6xl font-bold text-muted-foreground/20">404</p>
      <div>
        <h1 className="text-lg font-semibold mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This page doesn&apos;t exist or was moved.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          Go home
        </Link>
        <Link href="/dashboard" className={cn(buttonVariants({ size: 'sm' }))}>
          Dashboard
        </Link>
      </div>
    </div>
  )
}
