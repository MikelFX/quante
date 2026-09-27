// Visual editor v1 — what goes into the editing sandbox (2026-09-26). Server-only.
// The complete store as it would be built (buildStoreFiles), with the editable files
// instrumented (data-oid), the layout mounting the editor bridge, and the bridge itself.

import { buildStoreFiles } from '@/lib/store-template/build'
import { editorFileKeys, instrumentFiles, instrumentSource, type EditorNode } from '@/lib/editor/oid'
import { EDITOR_BRIDGE_PATH, editorBridgeSource, injectEditorBridge } from '@/lib/editor/bridge'
import type { SandboxFile } from '@/lib/editor/sandbox'
import type { CodeVersionFiles } from '@/types/store-code'

/** The clean (un-instrumented) text files of the built store, by path. */
export function cleanStoreFiles(codeFiles: CodeVersionFiles): { text: Record<string, string>; binary: SandboxFile[] } {
  const text: Record<string, string> = {}
  const binary: SandboxFile[] = []
  for (const f of buildStoreFiles(codeFiles)) {
    if (f.encoding === 'base64') binary.push({ path: f.path, content: Buffer.from(f.content, 'base64') })
    else text[f.path] = f.content
  }
  return { text, binary }
}

/**
 * The sandbox copy of next.config: the dev server must accept its own public host
 * (*.vercel.run). Without allowedDevOrigins Next.js blocks the HMR websocket as
 * cross-origin and its client falls into a full-page reload loop — the preview never
 * hydrates. devIndicators: false hides the Next.js "N" badge, which would cover the
 * store (e.g. the cookie bar). Sandbox only; the deployed config is untouched.
 */
export function withEditorDevOrigins(nextConfig: string): string {
  if (nextConfig.includes('allowedDevOrigins')) return nextConfig
  const anchor = nextConfig.match(/const nextConfig(?::\s*NextConfig)?\s*=\s*\{/)
  if (!anchor || anchor.index === undefined) return nextConfig
  const at = anchor.index + anchor[0].length
  return nextConfig.slice(0, at) + "\n  allowedDevOrigins: ['*.vercel.run'],\n  devIndicators: false," + nextConfig.slice(at)
}

export function prepareEditorFiles(codeFiles: CodeVersionFiles, parentOrigins: string[]): {
  files: SandboxFile[]
  nodes: Record<string, EditorNode>
} {
  const { text, binary } = cleanStoreFiles(codeFiles)
  const { files: instrumented, nodes } = instrumentFiles(text)
  const layout = injectEditorBridge(text['app/layout.tsx'] ?? '')
  if (!layout) throw new Error('This store layout has no <body> — the visual editor cannot attach.')
  const files: SandboxFile[] = Object.entries(text).map(([path, content]) => ({
    path,
    content: path === 'app/layout.tsx' ? layout
      : path === 'next.config.ts' ? withEditorDevOrigins(content)
        : (instrumented[path] ?? content),
  }))
  files.push(...binary, { path: EDITOR_BRIDGE_PATH, content: editorBridgeSource(parentOrigins) })
  return { files, nodes }
}

/** Re-instrument one edited file (for the sandbox) and rebuild the full oid map. */
export function reinstrument(text: Record<string, string>, path: string): { file: SandboxFile; nodes: Record<string, EditorNode>; key: string } {
  const key = editorFileKeys(Object.keys(text)).get(path)
  if (key === undefined) throw new Error('Not an editable file.')
  const file = { path, content: instrumentSource(path, text[path], key).code }
  return { file, nodes: instrumentFiles(text).nodes, key }
}
