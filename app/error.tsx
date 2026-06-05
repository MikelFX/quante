'use client'

import { useEffect } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-6">
      <p className="font-mono text-6xl font-bold text-muted-foreground/20">500</p>
      <div>
        <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. Try again, or contact support if the problem persists.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/50 font-mono mt-2">
            digest: {error.digest}
          </p>
        )}
      </div>
      <button
        onClick={reset}
        className={cn(buttonVariants({ size: 'sm' }))}
      >
        Try again
      </button>
    </div>
  )
}
