// Controls tuning — the porcelain, cobalt and brass values for one lab candidate.
//
// The law: DOM state stays exact while scene-local depth and light may change.
// The fault this candidate targets, 2026-08-30: a flat HTML control has 0px
// geometric depth and can cast no renderer-owned shadow, so a CSS-only sample
// cannot prove that the same live control became matter.
//
// Ownership: this file owns only perceptual choices. Surface identity, anchor
// receipts and input routing stay in the public Munari primitives (decisions.md
// #32: a tested demo law remains a demo law).

export type ControlMatter = 'porcelain' | 'cobalt' | 'brass' | 'recessed'

export const CONTROLS_BOARD = Object.freeze({ width: 760, height: 540 })

export const controlsTuning = Object.freeze({
  // Match-DOM stands one world unit from the camera. These depths are 1.1–2.8%
  // of that distance: enough for a side wall and a soft shadow without making
  // the raised face visibly change size as it approaches the eye.
  depth: Object.freeze({
    porcelain: 0.028,
    cobalt: 0.024,
    brass: 0.021,
    recessed: 0.011,
  } satisfies Readonly<Record<ControlMatter, number>>),
  // A 14/s exponential approach reaches 99% in 330ms. This is slower than a
  // click but faster than the 450ms default handoff settle, so the change reads
  // as a material rising rather than as another page transition.
  riseDamping: 14,
  // The shadow is a second presentation of shape, not content. Keeping it below
  // one-third opacity avoids the double-shadow fault described in decisions.md
  // #27 while still making 11px-deep fields legible against warm paper.
  shadowOpacity: 0.18,
  porcelain: '#e9e0ce',
  porcelainEdge: '#d7cbb4',
  cobalt: '#2148bd',
  cobaltEdge: '#142a75',
  brass: '#b38b4c',
  brassEdge: '#745529',
  shadow: '#3d2d22',
})
