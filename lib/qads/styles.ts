// Ad-style presets a user picks in the /qads generator form. Each entry ships
// a short Czech label (shown in the picker), an English "director-note" line
// that gets injected into the Claude prompt that writes the Higgsfield prompt,
// and a matching video-camera-movement hint (for video-only generations —
// ignored for image-only).
//
// Kept as a plain flat list so the picker can render it without any lookup,
// and the label→id map is done client-side. If a new style needs to be added,
// add here; no other change needed.

export type QadsStyleId = 'packshot' | 'lifestyle' | 'ugc' | 'cinematic' | 'minimal'

export interface QadsStyleDefinition {
  id: QadsStyleId
  label: string        // shown in the /qads style picker (Czech UI)
  description: string  // one-line explainer below the label, also Czech
  // Injected into the Claude prompt when it writes the Higgsfield image prompt.
  // English on purpose — Claude prompt-engineering is more reliable in
  // English, and the shipped strings never surface to the user.
  imageDirective: string
  // Same idea, for the video prompt. Includes a camera-move hint (dolly, pan,
  // slow push, etc.) — ignored when the user picked image-only.
  videoDirective: string
}

export const QADS_STYLES: QadsStyleDefinition[] = [
  {
    id: 'packshot',
    label: 'Studiový packshot',
    description: 'Čistá studiová fotka na jednolitém pozadí, žádné rušivé prvky.',
    imageDirective:
      'Studio packshot on a clean neutral background (light grey or off-white sweep). ' +
      'Even softbox lighting from front-left, subtle rim light. ' +
      'Product perfectly centred, macro-sharp label, no props.',
    videoDirective:
      'Slow 360° turntable around the product on a seamless neutral sweep. ' +
      'Constant softbox lighting, subtle rim light, no props. ' +
      'Camera at product-centre height, product perfectly framed the entire loop.',
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    description: 'Produkt v reálném prostředí, přirozené světlo, ruce v akci.',
    imageDirective:
      'Lifestyle scene: product held or placed in a warm real-world setting ' +
      '(kitchen counter, café table, wooden desk). Golden-hour window light, ' +
      'shallow depth of field, natural human hands may enter the frame.',
    videoDirective:
      'Handheld lifestyle shot: someone picks up the product from a warm real-world ' +
      'setting (café table, kitchen counter). Golden-hour window light, ' +
      'gentle camera shake, product stays in focus.',
  },
  {
    id: 'ugc',
    label: 'UGC / autentický',
    description: 'Vypadá jako by ho natočil zákazník na mobil, mírně chaotické.',
    imageDirective:
      'UGC-style photo taken on a modern smartphone, imperfect framing, ' +
      'ambient indoor light, mild sensor noise. Product held at arm\'s length ' +
      'in a home environment — sofa, kitchen, bathroom counter.',
    videoDirective:
      'UGC-style vertical smartphone video: someone films the product at arm\'s length ' +
      'in a home setting, imperfect framing, slight autofocus hunt, ambient indoor light. ' +
      'No music, no polish — feels shot by a real customer.',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Filmové osvětlení, hluboké stíny, prémiová atmosféra.',
    imageDirective:
      'Cinematic still: product lit with a single hard key light from the side, ' +
      'deep negative-fill shadows on the opposite side. Colour palette leans amber ' +
      'and teal. Shallow depth of field, product tack-sharp, background falls off dark.',
    videoDirective:
      'Cinematic slow dolly-in toward the product. Single hard key light, deep shadows, ' +
      'amber/teal colour grade, anamorphic feel. Product stays tack-sharp; background ' +
      'progressively falls out of focus as the camera moves in.',
  },
  {
    id: 'minimal',
    label: 'Minimal / editorial',
    description: 'Vzdušná kompozice, hodně bílé, jeden barevný akcent.',
    imageDirective:
      'Minimal editorial layout: product placed off-centre on a large flat colour field ' +
      '(soft cream, pale sage, or muted terracotta). Generous negative space, one small ' +
      'accent object (leaf, ribbon, pebble) for scale. Soft daylight, low contrast.',
    videoDirective:
      'Minimal editorial shot: static or very slow pan across a flat colour field ' +
      'with the product placed off-centre. One small accent object drifts into frame. ' +
      'Soft daylight, low contrast, generous negative space held on screen.',
  },
]

export function getQadsStyle(id: QadsStyleId): QadsStyleDefinition {
  const found = QADS_STYLES.find(s => s.id === id)
  if (!found) throw new Error(`Unknown Qads style: ${id}`)
  return found
}

export const QADS_STYLE_IDS: QadsStyleId[] = QADS_STYLES.map(s => s.id)

export function isValidStyleId(id: unknown): id is QadsStyleId {
  return typeof id === 'string' && QADS_STYLE_IDS.includes(id as QadsStyleId)
}
