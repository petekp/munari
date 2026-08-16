// REGISTRY — glass pack (2026-08-03)
// The pack's three welds (registry/glass/README.md):
//   1. The vendorable files are byte-identical to the reference consumer
//      (the preserved glass scene), so the lab's typecheck and browser
//      evidence cover the registry copy verbatim.
//   2. rippleLaw.ts is pinned to the capillary law's own mathematics, and
//      the shader TEXT is pinned to contain the same formulas — the twin
//      halves cannot drift apart silently: when two frames can't share
//      one computation, pin them to each other.
//   3. Compositing order is view-space z, never distance-to-eye —
//      pinned on the off-center scene where the two orders DISAGREE,
//      because they agree everywhere on the view axis and a centered
//      validation is the bug's whole camouflage.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ripplePhase,
  rippleWavenumber,
  rippleAmplitude,
  rippleDoppler,
  rippleRetirement,
  saturateTilt,
  MACH_CEILING,
  RETIRE_FRACTION,
  SPREAD_KNEE,
  TILT_SATURATION,
} from '../../registry/glass/rippleLaw'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the vendorable files are the lab files', () => {
  for (const f of ['glassSdf.tsx', 'glassSdfShader.ts']) {
    it(`registry/glass/${f} is byte-identical to apps/lab's`, () => {
      expect(read(`registry/glass/${f}`)).toBe(
        read(`apps/lab/src/scenes/glass/${f}`),
      )
    })
  }
})

// Weld 4: every glow array that reaches the compositor gets a clock.
//
// This is a TEXT pin, the same tool weld 2 uses on the shader, and for the
// same reason: the upload runs inside a useFrame and cannot be called without
// a renderer. It is here because the failure it guards is SILENT. A glow that
// is never stamped keeps `t0 < 0`, so `now - t0` is always past `glowLife`,
// and the upload's own age check skips it every frame without an error. The
// CTA's spill onto the card shipped exactly that way — the scene stamped the
// one array it was handed, the card's array was stamped by nobody, and two
// tweak knobs pointed at a strike that had never drawn a frame.
describe('every glow array gets a clock', () => {
  const compositor = read('registry/glass/glassSdf.tsx')
  const scene = read('apps/lab/src/scenes/glass/Glass.tsx')

  it('stamps in the compositor, before the age that consumes it', () => {
    const stamp = compositor.indexOf('if (gw.t0 < 0) gw.t0 = now')
    const age = compositor.indexOf('const age = now - gw.t0')
    expect(stamp).toBeGreaterThan(-1)
    expect(age).toBeGreaterThan(stamp)
  })

  it('and not in a scene, which only ever sees the arrays it was handed', () => {
    expect(scene).not.toMatch(/gw\.t0 < 0/)
  })
})

describe('the capillary law', () => {
  const K = 3.0
  const OPTS = { nu: 0.0018, source: 0.04, decay: 1.2 }

  it('the wavenumber IS the phase gradient: k = dθ/dr, analytically and numerically', () => {
    for (const [r, t] of [
      [0.1, 0.2],
      [0.4, 0.5],
      [0.9, 1.3],
    ] as const) {
      const eps = 1e-6
      const numeric =
        (ripplePhase(K, r + eps, t) - ripplePhase(K, r - eps, t)) / (2 * eps)
      expect(rippleWavenumber(K, r, t)).toBeCloseTo(numeric, 4)
    }
  })

  it('the train is self-similar along r ~ t^(2/3) — what a scrolled decal cannot fake', () => {
    // theta(α·r, α^(3/2)·t) = theta(r, t): stretch space by α and time by
    // α^(3/2) and every crest lands where it was.
    const [r, t] = [0.3, 0.4]
    for (const alpha of [0.5, 2, 3.7]) {
      expect(ripplePhase(K, alpha * r, Math.pow(alpha, 1.5) * t)).toBeCloseTo(
        ripplePhase(K, r, t),
        8,
      )
    }
    // Equivalently: the n-th crest (θ = 2πn) sits at r_n ∝ t^(2/3).
    const crestR = (n: number, tt: number) =>
      Math.cbrt((2 * Math.PI * n * tt * tt) / K)
    expect(ripplePhase(K, crestR(3, 0.7), 0.7)).toBeCloseTo(6 * Math.PI, 8)
    expect(crestR(3, 0.7 * 8) / crestR(3, 0.7)).toBeCloseTo(Math.pow(8, 2 / 3), 8)
  })

  it('the pattern gets finer outward: wavenumber grows with r at fixed t', () => {
    expect(rippleWavenumber(K, 0.6, 0.5)).toBeGreaterThan(
      rippleWavenumber(K, 0.3, 0.5),
    )
  })

  it('a circular front weakens as it travels: pure spreading is 1/√r past the knee', () => {
    // Far from the knee the spreading factor alone falls like 1/√r —
    // quadruple the radius, halve the amplitude. Isolate it from the
    // k-dependent terms by comparing against the law with nu = source = 0
    // and decay → ∞ at fixed t.
    const free = { nu: 0, source: 0, decay: Number.POSITIVE_INFINITY }
    const r0 = 40 * SPREAD_KNEE
    const ratio =
      rippleAmplitude(1, K, 4 * r0, 0.5, free) /
      rippleAmplitude(1, K, r0, 0.5, free)
    expect(ratio).toBeCloseTo(0.5, 1)
  })

  it('viscosity eats short waves: amplitude vanishes outward while phase does not', () => {
    const near = rippleAmplitude(1, K, 0.2, 0.3, OPTS)
    const far = rippleAmplitude(1, K, 2.0, 0.3, OPTS)
    expect(near).toBeGreaterThan(0)
    expect(far / near).toBeLessThan(1e-6)
    expect(ripplePhase(K, 2.0, 0.3)).toBeGreaterThan(0)
  })

  it('waves break: the summed tilt saturates below the bound, monotonically', () => {
    let prev = 0
    for (const s of [0.1, 0.5, 1.1, 3, 10, 1000]) {
      const out = saturateTilt(s)
      expect(out).toBeLessThan(TILT_SATURATION)
      expect(out).toBeGreaterThan(prev)
      prev = out
    }
  })
})

describe('a ripple dissipates; it does not disappear', () => {
  // The shipped tuning, and the numbers are the whole point of the bug.
  const LIFE = 1.8
  const DECAY = 1.2
  /** The spatially-uniform part of the amplitude — what a whole ripple fades by. */
  const envelope = (age: number) =>
    Math.exp(-age / DECAY) * rippleRetirement(age, LIFE)

  it('REGRESSION: the horizon used to amputate a ripple at a fifth of full strength', () => {
    // Without a retirement window the only thing fading a ripple out is bulk
    // decay, and bulk decay has no idea the array is about to evict it. At
    // the horizon it still had this much left, and then it was simply gone
    // on the next frame — the pop.
    expect(Math.exp(-LIFE / DECAY)).toBeGreaterThan(0.2)
    // With the window, the same instant is dark.
    expect(envelope(LIFE)).toBe(0)
  })

  it('reaches exactly zero at the horizon, for any pairing of life and decay', () => {
    // The guarantee has to be structural, not a tuning coincidence: the
    // slot budget may be re-tuned by a scene and must never re-open the seam.
    for (const life of [0.4, 1.8, 6]) {
      expect(rippleRetirement(life, life)).toBe(0)
      expect(rippleRetirement(life * 1.5, life)).toBe(0)
    }
  })

  it('has no step anywhere: consecutive frames never jump', () => {
    // 60fps over the whole life. A pop is precisely a large difference
    // between two adjacent samples, so this is the bug stated as a property.
    const frame = 1 / 60
    let prev = envelope(0)
    for (let age = frame; age <= LIFE + frame; age += frame) {
      const cur = envelope(age)
      expect(Math.abs(cur - prev)).toBeLessThan(0.05)
      prev = cur
    }
    expect(prev).toBe(0)
  })

  it('is inert until the last stretch — it removes a seam, it does not reshape the wave', () => {
    // Everything before the window is untouched, so the physics above still
    // owns the part of the life anyone actually watches.
    for (const u of [0, 0.2, 0.4, 1 - RETIRE_FRACTION]) {
      expect(rippleRetirement(u * LIFE, LIFE)).toBe(1)
    }
    expect(rippleRetirement((1 - RETIRE_FRACTION + 0.01) * LIFE, LIFE)).toBeLessThan(1)
  })
})

describe('a release is not a quieter impact', () => {
  const K = 3.0
  const BEAD = 0.18
  // The two events as the scene emits them: an impact loaded across the
  // bead's contact patch, a pinch-off launched from the neck of the liquid
  // bridge — a small fraction of the bead.
  const IMPACT = { nu: 0.0018, source: BEAD * 0.85, decay: 1.2 }
  const PINCH = { nu: 0.0018, source: BEAD * 0.14, decay: 1.2 }

  it('a small source radiates the short waves a broad one cannot', () => {
    // The source term is exp(-(k·src)²/2): it is a LOW-PASS whose cutoff is
    // the source itself. Nothing can radiate a wavelength shorter than the
    // thing that made it, which is the whole reason the two events differ in
    // character rather than only in volume.
    //
    // Compare at a radius where the local wavenumber is high — far out at a
    // young age — with both events normalised to the same launch amplitude.
    const [r, t] = [0.5, 0.25]
    const fine = rippleAmplitude(1, K, r, t, PINCH)
    const broad = rippleAmplitude(1, K, r, t, IMPACT)
    expect(fine).toBeGreaterThan(broad * 100)
  })

  it('so the impact is a CONFINED strong ring and the release a fine faint one', () => {
    // Worth stating carefully, because the naive reading of "the release is
    // smaller" is wrong in an interesting way.
    //
    // k grows with r, so the source low-pass is really a cutoff in RADIUS: a
    // broad source goes quiet beyond a small radius, a small one keeps
    // radiating further out. The impact therefore reads as a compact, strong,
    // low-frequency ring; the release as a fine, extended, very faint one.
    // Its smallness on screen is amplitude and wavelength, not extent — and
    // what finally bounds its extent is the shader's pixel-grid cutoff, which
    // culls exactly the waves too fine for the display to carry.
    const t = 0.3
    const reach = (opts: typeof IMPACT) => {
      const near = rippleAmplitude(1, K, 0.05, t, opts)
      let r = 0.05
      while (r < 4 && rippleAmplitude(1, K, r, t, opts) > near * 0.01) r += 0.01
      return r
    }
    expect(reach(IMPACT)).toBeLessThan(reach(PINCH))
  })

  it('and at fixed radius the train COARSENS with age — dispersion, not damping', () => {
    // The reason the test above talks about radius rather than time: k =
    // 3K r²/t² falls as t², so a fixed point sees ever longer waves arrive,
    // and the viscous term exp(-nu k² t) relaxes rather than compounds. Short
    // waves lead and long waves follow, which is the capillary regime's
    // signature and the thing a scrolled texture cannot reproduce.
    const r = 0.5
    expect(rippleWavenumber(K, r, 1.2)).toBeLessThan(rippleWavenumber(K, r, 0.25))
  })

  it('the per-ripple source reaches the shader, not a single panel-wide one', () => {
    // A panel-wide uniform could not tell an impact from a release; the array
    // is what makes the distinction expressible at all.
    const shader = read('registry/glass/glassSdfShader.ts')
    expect(shader).toContain('uniform float uRippleSrcR[MAX_RIPPLES];')
    expect(shader).toContain('float srcR = uRippleSrcR[i];')
    expect(shader).toContain('exp(-0.5 * kk * kk * srcR * srcR)')
  })
})

describe('the wake leans the way the bead went', () => {
  const C = 1.6

  it('a source at rest reproduces the stationary law exactly', () => {
    // The asymmetry must be a strict extension: with no velocity every
    // direction returns 1 and every term above is untouched.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0.3, -0.9]] as const) {
      expect(rippleDoppler(0, 0, dx, dy, C)).toBe(1)
    }
  })

  it('compresses ahead and stretches behind', () => {
    // D scales the age, and in theta = K r^3 / t^2 a smaller age means a
    // larger wavenumber. Ahead of the motion D < 1: shorter waves, bunched.
    const ahead = rippleDoppler(1, 0, 1, 0, C)
    const behind = rippleDoppler(1, 0, -1, 0, C)
    const abeam = rippleDoppler(1, 0, 0, 1, C)
    expect(ahead).toBeLessThan(1)
    expect(behind).toBeGreaterThan(1)
    expect(abeam).toBeCloseTo(1, 12)
    // Symmetric about the beam: what one side loses the other gains.
    expect(ahead + behind).toBeCloseTo(2, 12)
    // And it really does bunch the crests — the n-th crest sits closer in.
    const crest = (t: number) => Math.cbrt((2 * Math.PI * t * t) / 3.0)
    expect(crest(0.5 * ahead)).toBeLessThan(crest(0.5 * behind))
  })

  it('never reaches the shock: the factor stays bounded away from zero', () => {
    // At D = 0 the forward wavelength is zero and the first-order model is
    // simply wrong (physically: a cusped shock). The ceiling is what keeps
    // an arbitrarily fast satellite from tearing the surface open.
    // Every speed here is past c·MACH_CEILING = 1.04, so all of them clamp.
    for (const v of [1.05, 5, 500, 1e6]) {
      const d = rippleDoppler(v, 0, 1, 0, C)
      expect(d).toBeCloseTo(1 - MACH_CEILING, 12)
      expect(d).toBeGreaterThan(0)
    }
  })

  it('scales with speed below the ceiling', () => {
    const slow = rippleDoppler(0.2, 0, 1, 0, C)
    const fast = rippleDoppler(0.8, 0, 1, 0, C)
    expect(fast).toBeLessThan(slow)
    expect(slow).toBeLessThan(1)
  })
})

describe('the twin halves cannot drift apart (weld, in text)', () => {
  const shader = () => read('registry/glass/glassSdfShader.ts')

  it('the shader carries the exact phase and wavenumber formulas the twin models', () => {
    // `tw`, not `t`: the age the PHASE sees is Doppler-warped. The twin
    // models that as ripplePhase(K, r, t * rippleDoppler(...)) — see below.
    expect(shader()).toContain('uRippleK * r * r * r / (tw * tw)')
    expect(shader()).toContain('3.0 * uRippleK * r * r / (tw * tw)')
  })

  it('the shader carries the spreading knee and the saturation bound', () => {
    expect(shader()).toContain(`inversesqrt(1.0 + r / ${SPREAD_KNEE})`)
    expect(shader()).toContain(`1.0 / (1.0 + steep / ${TILT_SATURATION})`)
  })

  it('the shader carries the Doppler factor, at the ceiling the twin sets', () => {
    expect(shader()).toContain(`min(sp / max(uRippleWaveSpeed, 1e-6), ${MACH_CEILING})`)
    expect(shader()).toContain('dopp = 1.0 - mach * dot(vel / sp, dv / r)')
    // Warped age drives the phase; TRUE age drives the losses. If these ever
    // collapse to one variable the wake starts decaying by its geometry.
    expect(shader()).toContain('float tw = t * dopp;')
    expect(shader()).toContain('exp(-t / uRippleDecay)')
  })

  it('the retirement window lives in the uploader, where the budget is', () => {
    // It is not in the shader on purpose: it is not physics, it is the cost
    // of a finite uniform array, and it is applied once per ripple rather
    // than once per pixel.
    const src = read('registry/glass/glassSdf.tsx')
    expect(src).toContain(`RETIRE_FRACTION = ${RETIRE_FRACTION}`)
    expect(src).toContain('rippleRetirement(age, q.rippleLife)')
    expect(shader()).not.toContain('rippleRetirement')
  })
})

describe('the phase really is warped by the Doppler factor (twin composition)', () => {
  it('a crest sits closer in ahead of the motion than behind it', () => {
    // The shader computes ripplePhase at t * dopp. Same composition here:
    // at equal radius and age, the phase ahead has advanced further, which
    // is the same statement as the crests being packed tighter.
    const K = 3.0
    const [r, t, c] = [0.35, 0.5, 1.6]
    const ahead = ripplePhase(K, r, t * rippleDoppler(1, 0, 1, 0, c))
    const behind = ripplePhase(K, r, t * rippleDoppler(1, 0, -1, 0, c))
    expect(ahead).toBeGreaterThan(behind)
    // And with a still source both collapse back to the stationary value.
    const still = ripplePhase(K, r, t)
    expect(ripplePhase(K, r, t * rippleDoppler(0, 0, 1, 0, c))).toBe(still)
  })
})

describe('compositing order is view-space z, never distance-to-eye', () => {
  it('the off-center rail: farther by Pythagoras, no deeper at all — view z wins', () => {
    // Camera at origin looking down -z. A center panel 10 deep; a rail
    // panel out to the side, 9 deep but 10.8 from the eye. Distance says
    // the rail is farther (composite it first) — and then the panel
    // actually behind it refracts the rail's ink, every glyph smeared
    // through the dispersion taps with no error anywhere. On the view
    // axis the two orders agree, which is why a centered scene can
    // never catch it.
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)
    camera.updateMatrixWorld(true)

    const center = new THREE.Vector3(0, 0, -10)
    const rail = new THREE.Vector3(6, 0, -9)

    // Distance-to-eye order (the bug): rail first.
    const byDistance = [center, rail].sort(
      (a, b) => b.distanceTo(camera.position) - a.distanceTo(camera.position),
    )
    expect(byDistance[0]).toBe(rail)

    // View-space z order (the law, glassSdf.tsx's own computation):
    // depth is z after applyMatrix4(camera.matrixWorldInverse) — negative
    // ahead of the camera, more negative is farther — sorted ascending.
    const depthOf = (p: THREE.Vector3) =>
      p.clone().applyMatrix4(camera.matrixWorldInverse).z
    const byViewZ = [rail, center].sort((a, b) => depthOf(a) - depthOf(b))
    expect(byViewZ[0]).toBe(center)

    // And the two orders genuinely disagree on this scene — the test is
    // standing off-axis on purpose.
    expect(byDistance[0]).not.toBe(byViewZ[0])
  })

  it('the vendored compositor computes that key, in those words', () => {
    const src = read('registry/glass/glassSdf.tsx')
    expect(src).toContain('applyMatrix4(camera.matrixWorldInverse)')
    expect(src).toContain('panels.sort((a, b) => a.depth - b.depth)')
  })
})
