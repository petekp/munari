// The capillary ripple, as arithmetic — the TS twin of the wave train in
// glassSdfShader.ts. The shader is a string, so the two halves cannot
// share one computation the way Flight's shadow geometry and uniforms
// do; instead the pack's test welds them: these functions are pinned
// against the law's own mathematical properties, and the shader text is
// pinned to contain these exact formula expressions. Change either half
// alone and tests/registry/glassPack.test.ts fails.
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

// ── the two terms above are physics; the next one is not ──────────────────
//
// `rippleLife` is not a property of water. It exists because a panel has a
// FIXED number of uniform slots, so a ripple must eventually be evicted to
// make room for the next one. That is a budget, and a budget that shows is a
// bug: with the tuning that first exposed it (life 1.8s, decay 1.2s) a ripple
// still carried exp(-1.8/1.2) ≈ 22% of its envelope at the moment it was
// dropped, so it vanished between two frames instead of dissipating. The
// current tuning leans on the taper far harder — life 1.4s against decay 3.4s
// arrives at the horizon still holding 66% — which is exactly the pairing this
// window exists to make safe.
//
// The fix belongs HERE and not in the wave law, and the distinction is worth
// keeping sharp: the physics must not be bent to hide an implementation
// limit. Shortening `rippleDecay` until the tail happened to be invisible by
// 1.8s would have made every ripple die faster to solve a problem about
// arrays. Instead the law keeps its own decay and a separate window closes
// the ripple out over the last stretch of its budgeted life, reaching exactly
// zero AT the horizon for any pairing of life and decay.

/**
 * Fraction of the ripple's budgeted life spent easing out. The taper is
 * inert before this — the wave's own physics owns the early life entirely.
 */
export const RETIRE_FRACTION = 0.45

/**
 * The retirement window: 1 while the ripple is young, smoothly to exactly 0
 * at `age === life`. Smoothstep rather than a linear ramp because the ramp's
 * corner is itself visible — the eye reads a sudden change in the RATE of
 * fading as an event, which is the same class of artifact being removed.
 */
export function rippleRetirement(age: number, life: number): number {
  if (!(life > 0) || age >= life) return 0
  if (age <= 0) return 1
  const k = Math.min(1, (1 - age / life) / RETIRE_FRACTION)
  return k * k * (3 - 2 * k)
}

// ── breaking the circle ───────────────────────────────────────────────────
//
// Everything above is a function of r alone, which means that however good
// the radial profile is, the result is a radially symmetric function sampled
// at a radius — geometrically a texture lookup, and it reads as one. Real
// impact rings are not circles, and the reason is not noise: the thing that
// made them was MOVING.
//
// A source travelling through a dispersive medium radiates asymmetrically.
// Crests it emits forward are laid down into ground it is closing on, so they
// bunch; crests behind are laid into ground it is leaving, so they stretch.
// To first order in v/c that is the classical Doppler factor
//
//   D = 1 - (v/c)·cos(angle between the source's velocity and the direction)
//
// and it enters the wave train in exactly one place: the age. In θ = K r³/t²
// a smaller t means a larger local wavenumber, so scaling t by D compresses
// the pattern ahead of the motion and opens it behind. The same factor
// divides the amplitude, because the energy that piles into the compressed
// side has to come from somewhere.
//
// The point of routing the asymmetry through the emitter's velocity rather
// than through noise is that it is CORRELATED WITH VISIBLE MOTION: the wake
// leans the way the bead went, so the eye ties the disturbance to its cause.
// That correlation is what noise can never buy.

/**
 * How close to the wave speed a source is allowed to get. At D → 0 the
 * forward wavelength goes to zero and the model has a genuine singularity —
 * physically the onset of a cusped shock, which this first-order treatment
 * has no business rendering. Clamping keeps D ∈ [0.35, 1.65].
 */
export const MACH_CEILING = 0.65

/**
 * The Doppler factor for a source moving at (vx, vy) observed along (dx, dy).
 * Exactly 1 for a source at rest, so a ripple with no velocity reproduces the
 * stationary law above term for term.
 */
export function rippleDoppler(
  vx: number,
  vy: number,
  dx: number,
  dy: number,
  waveSpeed: number,
): number {
  const v = Math.hypot(vx, vy)
  const d = Math.hypot(dx, dy)
  if (v < 1e-6 || d < 1e-9) return 1
  const cos = (vx * dx + vy * dy) / (v * d)
  const mach = Math.min(v / Math.max(waveSpeed, 1e-6), MACH_CEILING)
  return 1 - mach * cos
}
