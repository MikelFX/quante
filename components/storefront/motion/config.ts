// Central motion configuration — single source of truth for all animation values.
// Every timing, easing, and distance lives here; nothing is hardcoded elsewhere.
// The AI (Quante) never writes animation code — it only sets manifest.design.motion.

export type MotionLevel = 'none' | 'subtle' | 'expressive'

export interface MotionConfig {
  enabled: boolean
  duration: { fast: number; base: number; slow: number }
  ease: [number, number, number, number]
  stagger: number
  revealY: number        // px, translateY for fade-up reveals
  revealBlur: number     // px, blur-in — expressive only (CPU cost)
  parallax: boolean      // off by default to avoid CLS on mobile
  parallaxStrength: number
  hoverScale: number
}

export const MOTION_CONFIG: Record<MotionLevel, MotionConfig> = {
  none: {
    enabled: false,
    duration: { fast: 0, base: 0, slow: 0 },
    ease: [0, 0, 1, 1],
    stagger: 0,
    revealY: 0,
    revealBlur: 0,
    parallax: false,
    parallaxStrength: 0,
    hoverScale: 1,
  },
  subtle: {
    enabled: true,
    duration: { fast: 0.15, base: 0.35, slow: 0.55 },
    ease: [0.25, 0.1, 0.25, 1],
    stagger: 0.08,
    revealY: 14,
    revealBlur: 0,
    parallax: false,   // parallax is a CLS hazard on mobile — opt-in only
    parallaxStrength: 0,
    hoverScale: 1.02,
  },
  expressive: {
    enabled: true,
    duration: { fast: 0.2, base: 0.45, slow: 0.7 },
    ease: [0.16, 1, 0.3, 1],
    stagger: 0.1,
    revealY: 24,
    revealBlur: 6,
    parallax: true,
    parallaxStrength: 0.15,
    hoverScale: 1.04,
  },
}

export function getMotionConfig(level: MotionLevel): MotionConfig {
  return MOTION_CONFIG[level]
}
