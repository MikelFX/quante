// Static description of the Qads pipeline's node graph — used by runner.ts to know what
// "in progress" means at each stage, and by components/qads/PipelineProgress.tsx (Qads
// step j) to render a live progress view without duplicating this list. Not itself
// executable — see runner.ts for the actual execution.
//
// Matches docs/qads-proposal.md §3.2:
//   brand_context -> strategy -> angles -> ad_sets -> ad copy (texts)
//                                       -> image prompts -> images -\
//                                       -> video prompts -> video  -+-> assembly -> validation -> (approval gate) -> deploy -> metrics sync
//
// Phase 1 implements brand_context through images (steps a/b/c). video/deploy nodes are
// added in later steps (d, f) — listed here already so the graph shape is stable and the
// UI doesn't need to change when they land.

export type QadsNodeId =
  | 'brand_context'
  | 'strategy'
  | 'angles'
  | 'ad_sets'
  | 'ad_copy'
  | 'image_prompts'
  | 'images'
  | 'video_prompts'
  | 'video'
  | 'assembly'
  | 'validation'
  | 'deploy'
  | 'metrics_sync'

export interface QadsNodeDef {
  id: QadsNodeId
  label: string
  dependsOn: QadsNodeId[]
  /** True once this step's implementation exists — false = defined for graph-shape stability only, not yet runnable. */
  implemented: boolean
}

export const QADS_PIPELINE_GRAPH: QadsNodeDef[] = [
  { id: 'brand_context', label: 'Reading brand context', dependsOn: [], implemented: true },
  { id: 'strategy', label: 'Generating strategy', dependsOn: ['brand_context'], implemented: true },
  { id: 'angles', label: 'Writing angles', dependsOn: ['strategy'], implemented: true },
  { id: 'ad_sets', label: 'Building ad sets', dependsOn: ['angles'], implemented: true },
  { id: 'ad_copy', label: 'Writing ad copy', dependsOn: ['ad_sets'], implemented: true },
  { id: 'image_prompts', label: 'Planning creative', dependsOn: ['ad_sets'], implemented: true },
  { id: 'images', label: 'Generating images', dependsOn: ['image_prompts'], implemented: true },
  { id: 'video_prompts', label: 'Planning video creative', dependsOn: ['ad_sets'], implemented: false },
  { id: 'video', label: 'Generating video', dependsOn: ['video_prompts'], implemented: false },
  { id: 'assembly', label: 'Assembling ads', dependsOn: ['ad_copy', 'images', 'video'], implemented: false },
  { id: 'validation', label: 'Validating campaign', dependsOn: ['assembly'], implemented: false },
  { id: 'deploy', label: 'Deploying (paused)', dependsOn: ['validation'], implemented: false },
  { id: 'metrics_sync', label: 'Syncing metrics', dependsOn: ['deploy'], implemented: false },
]

export function getImplementedNodeIds(): QadsNodeId[] {
  return QADS_PIPELINE_GRAPH.filter((n) => n.implemented).map((n) => n.id)
}
