// The sharpness instrument's arithmetic: how much edge energy is in a
// picture, and how a mesh's answer compares to the page's.
//
// The question this exists to answer is never "is this blurry" in the
// abstract — it is "is the mesh's rendering of this element as sharp as
// the element". So the only number that means anything is a RATIO
// against real DOM captured at the same pixels, and the instrument's
// job is to make that ratio cheap enough that nobody reasons about
// sharpness from a screenshot again.
//
// Gradient energy, not variance and not an FFT. Blur is a low-pass, and
// what it takes away first is the high-frequency content that lives in
// first differences: sum the squared step between neighbouring pixels
// and a softened image loses that sum monotonically, whatever the
// content is. Variance would not — a blur redistributes intensity
// without necessarily reducing its spread — and an FFT would answer
// more precisely at the cost of being something nobody reimplements
// correctly at 2 a.m.
//
// Two rules the numbers only mean anything under, both learned by
// getting them wrong:
//
//   The band is part of the measurement. Comparing whole cards let a
//   live frame-counter pill — present in the DOM, not yet drawn by the
//   mesh — contaminate the ratio by more than the defect being hunted.
//   Measure a rect that both pictures agree about, and say which.
//
//   A ratio is only a sharpness ratio if the two pictures are the same
//   size at the same place. A texture landing at the wrong scale in the
//   wrong spot will pass a naive check, because it still has edges.

/** Rec. 709 luma. Blur is a spatial effect; hue is not the signal. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** A rectangle in pixels, top-left origin. */
export interface Band {
  x: number
  y: number
  width: number
  height: number
}

/** An RGBA buffer with its own dimensions — `ImageData`, structurally. */
export interface Picture {
  data: Uint8ClampedArray | Uint8Array | number[]
  width: number
  height: number
}

/**
 * Mean squared first difference of luma over `band`, horizontally and
 * vertically.
 *
 * Normalized per sampled difference so two bands of different sizes are
 * comparable, and so a band that runs off the edge of the picture is
 * clipped rather than silently reading zeros — a clipped band still
 * answers honestly about the pixels it did see.
 */
export function gradientEnergy(pic: Picture, band?: Band): number {
  const x0 = Math.max(0, Math.floor(band?.x ?? 0))
  const y0 = Math.max(0, Math.floor(band?.y ?? 0))
  const x1 = Math.min(pic.width, Math.ceil((band?.x ?? 0) + (band?.width ?? pic.width)))
  const y1 = Math.min(pic.height, Math.ceil((band?.y ?? 0) + (band?.height ?? pic.height)))
  if (x1 - x0 < 2 || y1 - y0 < 2) return 0

  const at = (x: number, y: number) => {
    const i = (y * pic.width + x) * 4
    return luma(pic.data[i] ?? 0, pic.data[i + 1] ?? 0, pic.data[i + 2] ?? 0)
  }

  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = at(x, y)
      if (x + 1 < x1) {
        const d = at(x + 1, y) - c
        sum += d * d
        n++
      }
      if (y + 1 < y1) {
        const d = at(x, y + 1) - c
        sum += d * d
        n++
      }
    }
  }
  return n > 0 ? sum / n : 0
}

/** What one comparison produced, in the units it was measured in. */
export interface SharpnessReading {
  /** Edge energy of the mesh's rendering. */
  mesh: number
  /** Edge energy of the real DOM at the same pixels. */
  dom: number
  /** mesh / dom. 1.0 is parity; below 1 is softer than the page. */
  ratio: number
  /** The rect both numbers were taken over. */
  band: Band
}

/**
 * The comparison, in the only form that means anything.
 *
 * Below 1 is softer than the page — the reportable direction, and the
 * one every defect in this family has produced. Above 1 is not
 * automatically good news: an over-sharpened ratio is what ringing from
 * a mismatched scale looks like, so treat a reading far off parity in
 * either direction as a reason to look at the pictures.
 *
 * A DOM energy of zero means the reference band had no edges in it —
 * the wrong rect, or a capture taken before the page painted. That is a
 * broken measurement rather than infinite sharpness, so it reports NaN
 * instead of dividing.
 */
export function sharpnessRatio(mesh: Picture, dom: Picture, band?: Band): SharpnessReading {
  const b = band ?? { x: 0, y: 0, width: dom.width, height: dom.height }
  const m = gradientEnergy(mesh, b)
  const d = gradientEnergy(dom, b)
  return { mesh: m, dom: d, ratio: d > 0 ? m / d : Number.NaN, band: b }
}
