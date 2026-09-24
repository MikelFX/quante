// HTML-context helpers for server-rendered strings (emails, invoices, maintenance
// pages, anything built with template literals instead of JSX). Use escapeHtml on
// EVERY user- or AI-controlled value interpolated into markup, and safeHttpUrl on
// every value that ends up in an href/src attribute.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

/** Escapes & < > " ' and ` so the value is safe in element text and quoted attributes. */
export function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/**
 * Returns a normalised absolute URL only when it is http(s); null for anything else
 * (javascript:, data:, vbscript:, relative/protocol-relative junk, unparsable input).
 * The result still needs escapeHtml when placed inside an attribute.
 */
export function safeHttpUrl(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const trimmed = s.trim()
  if (!trimmed || trimmed.length > 2048) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // Credentials in URLs are a phishing vector (https://bank.com@evil.com) — reject.
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}
