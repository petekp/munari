// Cutaway depth law — where the section plane stands for a scroll position,
// and what the lens throws onto the sheet standing there.
//
// The law: reading deeper cuts deeper. Each section of the spec sheet names
// one part. When that section's heading reaches the reading line, the plane
// stands just behind that part, so the part has crossed in front of its own
// paragraph. Between headings the plane moves linearly with scroll, so a
// reader who stops between two parts sees a cut between them.
//
// The optics are a thin lens focused at infinity, so its focal plane is the
// sensor's surface. Light it projects onto the sheet blurs by the aperture
// radius times the defocus over the focal length, and sharpens to a point
// only where the sensor sits.
//
// Ownership: this module owns the arithmetic. The scene owns the stations
// (measured from the sheet's own layout) and pushes the results into shader
// uniforms, so the shader never repeats this math.

export interface CutStation {
  /** The scroll offset, in CSS px, at which this station's heading meets the reading line. */
  readonly scroll: number
  /** The plane's depth in model millimetres; deeper is a smaller z. */
  readonly depth: number
}

/** The section plane's depth for a scroll offset, clamped to the first and last station. */
export function cutDepthAt(scroll: number, stations: readonly CutStation[]): number {
  const first = stations[0]
  if (!first) throw new Error('cutDepthAt needs at least one station')
  if (scroll <= first.scroll) return first.depth
  for (let i = 1; i < stations.length; i++) {
    const before = stations[i - 1]
    const after = stations[i]
    if (!before || !after) break
    if (scroll <= after.scroll) {
      const span = after.scroll - before.scroll
      const t = span > 0 ? (scroll - before.scroll) / span : 1
      return before.depth + (after.depth - before.depth) * t
    }
  }
  const last = stations[stations.length - 1]
  return last ? last.depth : first.depth
}

/** The index of the last station the plane has reached at this depth. */
export function stationIndexAt(depth: number, stations: readonly CutStation[]): number {
  let index = 0
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i]
    if (station && depth <= station.depth + 1e-6) index = i
  }
  return index
}

export interface ThinLens {
  /** Model z of the principal plane, in mm. */
  readonly principalZ: number
  readonly focalLength: number
  /** Entrance pupil radius in mm: focal length over twice the f-number. */
  readonly apertureRadius: number
}

export interface SheetProjection {
  /** Distance from the principal plane to the sheet, in mm. */
  readonly distance: number
  /** Radius of the blur circle on the sheet, in mm. */
  readonly blurRadius: number
  /** Irradiance relative to the in-focus image. */
  readonly irradiance: number
}

/** What a lens focused at infinity throws onto a sheet at depth sheetZ. */
export function projectOntoSheet(sheetZ: number, lens: ThinLens): SheetProjection {
  const distance = Math.max(0.5, lens.principalZ - sheetZ)
  const blurRadius = (lens.apertureRadius * Math.abs(distance - lens.focalLength)) / lens.focalLength
  // An extended source's image grows with distance², spreading the same flux.
  const ratio = lens.focalLength / distance
  const irradiance = Math.min(2.5, Math.max(0.35, ratio * ratio))
  return { distance, blurRadius, irradiance }
}
