// Validates AI-generated custom React components before injection.
// Enforces: allowlisted imports only, no network calls, no dangerous APIs.

import 'server-only'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// Imports that are always allowed in generated components
const ALLOWED_IMPORT_SOURCES = new Set([
  'react',
  'react/jsx-runtime',
  'framer-motion',
])

// Dangerous patterns that must not appear in generated code
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bfetch\s*\(/g,                         description: 'Network: fetch()' },
  { pattern: /\bXMLHttpRequest\b/g,                   description: 'Network: XMLHttpRequest' },
  { pattern: /\bWebSocket\b/g,                        description: 'Network: WebSocket' },
  { pattern: /\bimport\s*\(\s*['"`]/g,                description: 'Dynamic import()' },
  { pattern: /\brequire\s*\(/g,                       description: 'require() call' },
  { pattern: /\beval\s*\(/g,                          description: 'eval()' },
  { pattern: /\bnew\s+Function\s*\(/g,                description: 'new Function()' },
  { pattern: /\bprocess\s*\.\s*env\b/g,               description: 'process.env access' },
  { pattern: /\bdocument\s*\.\s*(cookie|write)\b/g,   description: 'document.cookie / document.write' },
  { pattern: /\blocalStorage\b|\bsessionStorage\b/g,  description: 'Storage API' },
  { pattern: /\bwindow\s*\.\s*location\s*=/g,         description: 'window.location assignment' },
  { pattern: /\bdangerouslySetInnerHTML\b/g,          description: 'dangerouslySetInnerHTML' },
  { pattern: /\bchild_process\b/g,                    description: 'child_process' },
  { pattern: /\bfs\s*\.\s*(read|write|unlink|rm)\b/g, description: 'Node fs write operations' },
  { pattern: /\bcrypto\s*\.\s*subtle\b/g,             description: 'Crypto subtle API' },
]

// Checks that all static imports are from the allowlist
function validateImports(code: string): string[] {
  const errors: string[] = []
  // Match both: import X from 'y' and import { X } from "y"
  const importRegex = /^\s*import\s+.+?\s+from\s+['"`]([^'"`]+)['"`]/gm
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(code)) !== null) {
    const source = match[1]
    if (!ALLOWED_IMPORT_SOURCES.has(source)) {
      errors.push(`Disallowed import: "${source}"`)
    }
  }
  return errors
}

// Checks for forbidden patterns
function validatePatterns(code: string): string[] {
  const errors: string[] = []
  for (const { pattern, description } of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(code)) {
      errors.push(`Forbidden: ${description}`)
    }
  }
  return errors
}

// Checks for a default export (required for the section registry)
function validateExport(code: string): string[] {
  if (!/export\s+default\s+/.test(code)) {
    return ['Component must have a default export']
  }
  return []
}

// Checks the component is not excessively large (runaway generation guard)
const MAX_BYTES = 32_000
function validateSize(code: string): string[] {
  if (Buffer.byteLength(code, 'utf8') > MAX_BYTES) {
    return [`Component exceeds maximum size (${MAX_BYTES} bytes)`]
  }
  return []
}

export function validateCustomComponent(code: string): ValidationResult {
  const errors: string[] = [
    ...validateSize(code),
    ...validateImports(code),
    ...validatePatterns(code),
    ...validateExport(code),
  ]

  const warnings: string[] = []
  // Warn on window/document usage that isn't outright forbidden
  if (/\bwindow\b/.test(code)) warnings.push('Uses window — ensure SSR compatibility with typeof window checks')
  if (/\bdocument\b/.test(code)) warnings.push('Uses document — ensure SSR compatibility')
  if (/\buseEffect\b/.test(code) && !/\[\s*\]/.test(code)) {
    warnings.push('useEffect with no empty-deps array detected — verify it does not cause infinite re-renders')
  }

  return { valid: errors.length === 0, errors, warnings }
}
