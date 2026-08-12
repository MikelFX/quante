// GET /api/quante/generate/status?jobId=<uuid>
//
// Level 3's polling endpoint — the only channel a client has into a generation running via
// /api/quante/generate's after()-scheduled background work (see the architecture comment
// there and in docs/update-log.md). Reads through the user-scoped Supabase client, so RLS
// (see supabase/migration-generation-jobs.sql) is the actual access control: a jobId that
// exists but belongs to someone else looks identical to one that doesn't exist at all
// (both come back as "no row"), which is the correct, non-enumerable behavior for a
// client-facing status lookup.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import type { JobStatusPayload } from '@/lib/generation-poll'

const RAW_OUTPUT_TAIL_CHARS = 3000

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')?.trim()
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('status, phase, raw_output, files, summary, error, project_id, deployment_id, preview_url, code_version_id')
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    console.error('[generate/status] query failed:', error)
    return NextResponse.json({ error: 'Could not load generation status.' }, { status: 500 })
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const payload: JobStatusPayload = {
    status: job.status,
    phase: job.phase,
    files: job.files ?? {},
    rawOutputTail: (job.raw_output ?? '').slice(-RAW_OUTPUT_TAIL_CHARS),
    summary: job.summary,
    error: job.error,
    projectId: job.project_id,
    deploymentId: job.deployment_id,
    previewUrl: job.preview_url,
    codeVersionId: job.code_version_id,
  }

  return NextResponse.json(payload)
}
