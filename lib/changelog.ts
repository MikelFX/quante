// Shared tag registry + slug helper for the product changelog.
// Kept in sync with app/(marketing)/changelog/page.tsx color maps
// and app/api/admin/changelog/route.ts validation.

export const CHANGELOG_TAGS = [
  'feature',
  'bugfix',
  'platform',
  'ai',
  'design',
  'domains',
  'reliability',
] as const

export type ChangelogTag = (typeof CHANGELOG_TAGS)[number]

export function isChangelogTag(value: unknown): value is ChangelogTag {
  return typeof value === 'string' && (CHANGELOG_TAGS as readonly string[]).includes(value)
}

export const TAG_BG: Record<ChangelogTag, string> = {
  feature:     'rgba(52,211,153,.18)',
  bugfix:      'rgba(248,113,113,.15)',
  platform:    'rgba(111,120,230,.18)',
  ai:          'rgba(99,102,241,.18)',
  design:      'rgba(251,191,36,.15)',
  domains:     'rgba(34,211,238,.15)',
  reliability: 'rgba(52,211,153,.15)',
}

export const TAG_FG: Record<ChangelogTag, string> = {
  feature:     '#34d399',
  bugfix:      '#f87171',
  platform:    '#7a82e8',
  ai:          '#a5b4fc',
  design:      '#fbbf24',
  domains:     '#22d3ee',
  reliability: '#34d399',
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
