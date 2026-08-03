// REGISTRY — glass pack (2026-08-03)
// The pack's three welds (registry/glass/README.md):
//   1. The vendorable files are byte-identical to the reference consumer
//      (the preserved Lab 012), so the lab's typecheck and browser
//      evidence cover the registry copy verbatim.
//   2. rippleLaw.ts is pinned to the capillary law's own mathematics, and
//      the shader TEXT is pinned to contain the same formulas — the twin
//      halves cannot drift apart silently (archive#40; weld style per
//      archive#56: when two frames can't share one computation, pin them
//      to each other).
//   3. Compositing order is view-space z, never distance-to-eye
//      (archive#43) — pinned on the off-center scene where the two
//      orders DISAGREE, because they agree everywhere on the view axis
//      and a centered validation is the bug's whole camouflage.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ripplePhase,
  rippleWavenumber,
  rippleAmplitude,
  saturateTilt,
  SPREAD_KNEE,
  TILT_SATURATION,
} from '../../registry/glass/rippleLaw'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the vendorable files are the lab files', () => {
  for (const f of ['glassSdf.tsx', 'glassSdfShader.ts']) {
    it(`registry/glass/${f} is byte-identical to apps/lab's`, () => {
      expect(read(`registry/glass/${f}`)).toBe(
        read(`apps/lab/src/scenes/${f}`),
      )
    })
  }
})

describe('the capillary law (archive#40)', () => {
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

describe('the twin halves cannot drift apart (archive#56 weld, in text)', () => {
  const shader = () => read('registry/glass/glassSdfShader.ts')

  it('the shader carries the exact phase and wavenumber formulas the twin models', () => {
    expect(shader()).toContain('uRippleK * r * r * r / (t * t)')
    expect(shader()).toContain('3.0 * uRippleK * r * r / (t * t)')
  })

  it('the shader carries the spreading knee and the saturation bound', () => {
    expect(shader()).toContain(`inversesqrt(1.0 + r / ${SPREAD_KNEE})`)
    expect(shader()).toContain(`1.0 / (1.0 + steep / ${TILT_SATURATION})`)
  })
})

describe('compositing order is view-space z, never distance-to-eye (archive#43)', () => {
  it('the off-center rail: farther by Pythagoras, no deeper at all — view z wins', () => {
    // Camera at origin looking down -z. A center panel 10 deep; a rail
    // panel out to the side, 9 deep but 10.8 from the eye. Distance says
    // the rail is farther (composite it first) — and then the panel
    // actually behind it refracts the rail's ink, every glyph smeared
    // through the dispersion taps with no error anywhere. This is the
    // exact geometry the archive measured; on the view axis the two
    // orders agree, which is why a centered scene can never catch it.
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
