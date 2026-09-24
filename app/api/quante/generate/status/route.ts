// GET /api/quante/generate/status?jobId=<uuid>
//
// Level 3's polling endpoint — the only channel a client has into a generation running via
// /api/quante/generate's after()-scheduled background work (see the architecture comment
// there and in docs/update-log.md). The Supabase client here is the service-role client, so
// RLS does NOT apply — access control is the explicit `.eq('user_id', userId)` filter on
// every read: a jobId that exists but belongs to someone else looks identical to one that
// doesn't exist at all (both come back as "no row" → 404).
//
// Output exposure is limited to what the UI needs: `rawOutputTail` only while the job is
// running (live progress). `files` is always {} (kept for payload compatibility) — no
// client reads it (the Studio loads saved code from code_versions), and returning the
// raw file map (including non-store paths the model emitted) made a completed-but-
// refunded job a free model proxy. A failed job returns no output at all.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'
import type { JobStatusPayload } from '@/lib/generation-poll'
import { normalizeDroppedFiles, type DroppedFile } from '@/lib/generation-checkpoint'

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
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const supabase = supabaseAdmin
  // Columns added by later migrations are read defensively: try the newest column set
  // first and fall back step by step if a column doesn't exist yet on this environment
  // (deploy_error; dropped_files from supabase/migration-security2-gen-pipeline.sql).
  // Same defensive pattern as the writers in /api/quante/generate/route.ts.
  const baseColumns = 'status, phase, raw_output, summary, error, project_id, deployment_id, preview_url, code_version_id'
  interface JobRow {
    status: JobStatusPayload['status']
    phase: JobStatusPayload['phase']
    raw_output: string | null
    summary: string | null
    error: string | null
    project_id: string | null
    deployment_id: string | null
    preview_url: string | null
    code_version_id: string | null
    deploy_error?: string | null
    dropped_files?: unknown
  }
  let job: JobRow | null = null
  let queryError: unknown = null

  const columnSets = [
    `${baseColumns}, deploy_error, dropped_files`,
    `${baseColumns}, deploy_error`,
    baseColumns,
  ]
  for (const columns of columnSets) {
    const res = await supabase
      .from('generation_jobs')
      .select(columns)
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle()
    job = (res.data as unknown as JobRow | null) ?? null
    queryError = res.error
    if (!queryError) break
    console.warn('[generate/status] select failed (column missing?), retrying with fewer columns:', queryError)
  }

  if (queryError) {
    console.error('[generate/status] query failed:', queryError)
    return NextResponse.json({ error: 'Could not load generation status.' }, { status: 500 })
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const payload: JobStatusPayload = {
    status: job.status,
    phase: job.phase,
    files: {},
    rawOutputTail: job.status === 'running' ? (job.raw_output ?? '').slice(-RAW_OUTPUT_TAIL_CHARS) : '',
    summary: job.summary,
    error: job.error,
    projectId: job.project_id,
    deploymentId: job.deployment_id,
    previewUrl: job.preview_url,
    codeVersionId: job.code_version_id,
    deployError: job.deploy_error ?? null,
  }

  // Additive fields (audit #23): AI files the safety filter removed before the code was
  // saved/deployed, so the Studio can tell the user what was left out and why.
  const dropped = Array.isArray(job.dropped_files)
    ? normalizeDroppedFiles(
        (job.dropped_files as unknown[]).filter(
          (d): d is DroppedFile => !!d && typeof d === 'object' && typeof (d as DroppedFile).path === 'string',
        ),
      )
    : []
  const response: JobStatusPayload & { droppedFiles: string[]; droppedFileDetails: DroppedFile[] } = {
    ...payload,
    droppedFiles: dropped.map((d) => d.path),
    droppedFileDetails: dropped,
  }

  return NextResponse.json(response)
}
