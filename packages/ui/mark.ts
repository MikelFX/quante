// The AssetraDigital / Quante mark (owner picked „Pixel“, 2026-10-27): an A on a 7 × 7 grid of
// 8-unit pixels, viewBox 0 0 56 56, with one accent pixel in the crossbar. Plain data, no imports,
// so OG image routes (edge) and components outside the .ad scope can draw the same mark as AdMark.
export const AD_MARK_VIEWBOX = '0 0 56 56'
export const AD_MARK_PATH = 'M16 0h24v8h-24zM8 8h16v8h-16zM32 8h16v8h-16zM0 16h16v8h-16zM40 16h16v8h-16zM0 24h16v8h-16zM40 24h16v8h-16zM0 32h24v8h-24zM32 32h24v8h-24zM0 40h16v8h-16zM40 40h16v8h-16zM0 48h16v8h-16zM40 48h16v8h-16z'
/** The accent pixel: x, y, size. */
export const AD_MARK_PIXEL = { x: 24, y: 32, size: 8 } as const
