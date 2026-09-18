// Two-proportion z-test — the frequentist option docs/qads-proposal.md §8/§9 left open
// ("either is fine engineering-wise, it's a product/tone decision on what reads
// clearest to a non-technical merchant"). Picked over a Bayesian approach because its
// output (a p-value / "95% confidence" framing) is what most merchants already expect
// from "A/B test significance" language elsewhere on the web — flagging this as the
// decision made here per the project's "tell me about anything with architectural
// impact" instruction, since swapping to a Bayesian credible-interval framing later
// would change this module's return shape, not just its internals.
//
// Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation (max error
// ~1.5e-7) — no external stats dependency needed for this.

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

export interface ZTestResult {
  z: number
  pValue: number // two-tailed
  significantAt95: boolean
  rateA: number
  rateB: number
}

// successesA/trialsA = the challenger variant (e.g. clicks/conversions over impressions/
// clicks); successesB/trialsB = the variant it's being compared against (typically
// whichever variant currently has the highest rate).
export function twoProportionZTest(successesA: number, trialsA: number, successesB: number, trialsB: number): ZTestResult | null {
  if (trialsA <= 0 || trialsB <= 0) return null
  const rateA = successesA / trialsA
  const rateB = successesB / trialsB
  const pooled = (successesA + successesB) / (trialsA + trialsB)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB))
  if (se === 0) return { z: 0, pValue: 1, significantAt95: false, rateA, rateB }
  const z = (rateA - rateB) / se
  const pValue = 2 * (1 - normalCdf(Math.abs(z)))
  return { z, pValue, significantAt95: pValue < 0.05, rateA, rateB }
}

// Simplified minimum-sample heuristic — NOT a formal statistical power calculation
// (that needs an assumed baseline rate and minimum detectable effect, which nothing in
// this pipeline collects today). This is a floor below which "significant" results are
// refused regardless of what the z-test says, per the brief's explicit
// "nevyhlašuj vítěze z padesáti impresí" instruction — flagged as an open item if the
// user wants a real power-analysis-driven sample size instead.
export const MIN_SUCCESSES_PER_VARIANT = 30

export function minSampleNote(successes: number): string | null {
  if (successes >= MIN_SUCCESSES_PER_VARIANT) return null
  const needed = MIN_SUCCESSES_PER_VARIANT - successes
  return `${successes} so far — need ~${needed} more for a reliable read (floor: ${MIN_SUCCESSES_PER_VARIANT} per variant)`
}
