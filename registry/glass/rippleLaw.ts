// The capillary ripple, as arithmetic — the TS twin of the wave train in
// glassSdfShader.ts (archive#40). The shader is a string, so the two
// halves cannot share one computation the way shadowQuadFrame's geometry
// and uniforms do (archive#56); instead the pack's test welds them: these
// functions are pinned against the law's own mathematical properties, and
// the shader text is pinned to contain these exact formula expressions.
// Change either half alone and tests/registry/glassPack.test.ts fails.
//
// The physics, compressed from the shader's derivation: at bead scale the
// dispersion regime is capillary (surface tension, not gravity), so
// w = C·k^(3/2) and SHORT waves lead. Feeding the stationary-phase
// condition r = v_group·t back into the phase collapses the whole train
// to one closed form:
//
//   theta(r, t) = K r^3 / t^2,          K = 4 / (27 C^2)
//   k(r, t)     = d(theta)/dr = 3 K r^2 / t^2
//
// The derivative of the phase IS the stationary wavenumber — the two
// expressions are consistent by construction, and the pattern is
// self-similar along r ~ t^(2/3), which is what a fixed-wavelength packet
// scrolled outward cannot fake.

/** Phase of the train at radius r (panel units), age t (seconds). */
export function ripplePhase(K: number, r: number, t: number): number {
  return (K * r * r * r) / (t * t)
}

/** Local wavenumber — analytically d(ripplePhase)/dr. */
export function rippleWavenumber(K: number, r: number, t: number): number {
  return (3 * K * r * r) / (t * t)
}

/**
 * The knee of the 1/sqrt(r) energy spreading: below this radius the front
 * is "still the bead", above it a circular front weakens as it must. The
 * shader's `inversesqrt(1.0 + r / 0.25)`.
 */
export const SPREAD_KNEE = 0.25

/**
 * Amplitude envelope — the shader's "three physical terms and no fudge",
 * plus the finite source. Deliberately EXCLUDES the pixel-grid cutoff
 * (`kk * aa` smoothstep): that term is the display's, not the law's — it
 * depends on the panel's world-units-per-pixel, and viscosity has already
 * taken the waves it removes.
 *
 *   spreading  1/sqrt(1 + r/knee)  — energy over a growing circumference
 *   viscosity  exp(-nu k^2 t)      — eats short waves quadratically
 *   source     exp(-(k*src)^2 / 2) — a bead is not a delta; it cannot
 *                                    radiate wavelengths shorter than
 *                                    itself, and suppressing those removes
 *                                    the first-frame crack with no ramp
 *   bulk loss  exp(-t / decay)     — the sheet eventually goes still
 */
export function rippleAmplitude(
  amp0: number,
  K: number,
  r: number,
  t: number,
  opts: { nu: number; source: number; decay: number },
): number {
  const k = rippleWavenumber(K, r, t)
  return (
    amp0 *
    (1 / Math.sqrt(1 + r / SPREAD_KNEE)) *
    Math.exp(-opts.nu * k * k * t) *
    Math.exp(-0.5 * k * k * opts.source * opts.source) *
    Math.exp(-t / opts.decay)
  )
}

/** The surface tilt contribution: h = amp·cos(theta) → dh/dr = -amp·k·sin(theta). */
export function rippleTilt(
  amp0: number,
  K: number,
  r: number,
  t: number,
  opts: { nu: number; source: number; decay: number },
): number {
  return (
    -rippleAmplitude(amp0, K, r, t, opts) *
    rippleWavenumber(K, r, t) *
    Math.sin(ripplePhase(K, r, t))
  )
}

/**
 * Waves break: past a certain steepness a real surface stops being a graph
 * over the plane, so the summed tilt saturates softly instead of folding
 * the lens inside out. The output magnitude never reaches this bound.
 */
export const TILT_SATURATION = 1.1

export function saturateTilt(steepness: number): number {
  return steepness / (1 + steepness / TILT_SATURATION)
}
