import { describe, expect, it } from 'vitest'
import {
  CFL_C2,
  FIELD_SIM_FRAG,
  PAGE_FRAG,
  WAVE_C2,
  WAVE_DAMPING,
  settleSteps,
  sheen,
  waveStep,
} from './wakeField'

/**
 * The worst mode the grid can hold: alternating texels, so every neighbour of
 * a peak is a trough. Its Laplacian is (−4h) − 4h = −8h, and it is the mode
 * that decides stability — a scheme that survives it survives everything
 * smoother. Running it directly is the cheapest possible honest test of the
 * Courant bound: no grid, no shader, one number.
 */
function checkerboard(c2: number, steps: number, damping = 1): number {
  let h = 1
  let hPrev = 1
  for (let i = 0; i < steps; i++) {
    const next = waveStep(h, hPrev, -8 * h, c2, damping)
    hPrev = h
    h = next
    if (!Number.isFinite(h)) return Infinity
  }
  return Math.abs(h)
}

describe('waveStep', () => {
  it('leaves still water still', () => {
    expect(waveStep(0, 0, 0, WAVE_C2, WAVE_DAMPING)).toBe(0)
  })

  it('accelerates a depression back toward flat', () => {
    // A dimple at rest: the centre is below its neighbours, so the Laplacian
    // is positive and the next step must be higher than this one.
    const next = waveStep(-1, -1, 4, WAVE_C2, 1)
    expect(next).toBeGreaterThan(-1)
  })

  it('conserves a travelling disturbance when undamped', () => {
    // Undamped, at the shipped speed, the roughest mode neither grows nor
    // dies — it rings. This is the property the damping term is there to
    // remove, and it has to exist before removing it means anything.
    expect(checkerboard(WAVE_C2, 4000)).toBeLessThan(4)
    expect(checkerboard(WAVE_C2, 4000)).toBeGreaterThan(0)
  })

  it('is stable strictly below the Courant bound', () => {
    for (const c2 of [0.05, 0.125, 0.25, 0.4, 0.49]) {
      expect(checkerboard(c2, 4000)).toBeLessThan(10)
    }
  })

  it('grows LINEARLY at the bound itself — the root is repeated there', () => {
    // The bound is a supremum, not a setting. At c² = ½ exactly, the two
    // roots of the recurrence collide at −1, and a repeated root contributes
    // a term in n·λⁿ: the checkerboard does not ring, it ramps. Doubling the
    // step count doubles the amplitude, which is the signature of linear
    // growth and not of an instability that has merely not caught fire yet.
    const a = checkerboard(CFL_C2, 2000)
    const b = checkerboard(CFL_C2, 4000)
    expect(a).toBeGreaterThan(100)
    expect(b / a).toBeGreaterThan(1.9)
    expect(b / a).toBeLessThan(2.1)
  })

  it('diverges past it — which is why the bound is a constant and not a comment', () => {
    // Above the bound the growth turns geometric and the failure has no soft
    // edge and no symptom in JS.
    expect(checkerboard(CFL_C2 + 0.01, 4000)).toBe(Infinity)
    expect(checkerboard(1, 4000)).toBe(Infinity)
  })

  it('runs the scene at half the bound', () => {
    expect(WAVE_C2).toBeLessThanOrEqual(CFL_C2 / 2)
  })
})

describe('settleSteps', () => {
  it('agrees with actually running the decay', () => {
    const predicted = settleSteps(WAVE_DAMPING)
    let a = 1
    let steps = 0
    while (a > 1 / 255) {
      a *= WAVE_DAMPING
      steps++
    }
    expect(predicted).toBe(steps)
  })

  it('is a real settle window and not a rounding artifact', () => {
    // ~14 s at 120 Hz. Long enough that the last ripple is gone rather than
    // cut off, short enough that the scene is not stepping a dead field for
    // the rest of the session.
    expect(settleSteps(WAVE_DAMPING)).toBeGreaterThan(600)
    expect(settleSteps(WAVE_DAMPING)).toBeLessThan(3000)
  })

  it('lengthens as the damping softens', () => {
    expect(settleSteps(0.99)).toBeLessThan(settleSteps(0.999))
  })

  it('never finishes without damping', () => {
    expect(settleSteps(1)).toBe(Infinity)
    expect(settleSteps(1.01)).toBe(Infinity)
  })

  it('is already over for a disturbance below the floor', () => {
    expect(settleSteps(WAVE_DAMPING, 1 / 1000)).toBe(0)
  })
})

describe('sheen', () => {
  it('is EXACTLY zero on flat water — rest is exact, not nearly exact', () => {
    // The whole reason the highlight is slope-driven rather than a textbook
    // specular against the normal. A settled page has to be the DOM again,
    // and "a constant so small you cannot see it" is not the same claim.
    expect(sheen(0, 0, 0.6, 0.8, 3)).toBe(0)
    expect(sheen(0, 0, 0, 1, 1e6)).toBe(0)
  })

  it('lights the face of a wave that leans into the light', () => {
    expect(sheen(0.6, 0.8, 0.6, 0.8, 1)).toBeGreaterThan(0.9)
  })

  it('leaves the far side of the same wave dark, never negative', () => {
    expect(sheen(-0.6, -0.8, 0.6, 0.8, 1)).toBe(0)
  })

  it('is visible at the slopes a real ripple actually reaches', () => {
    // The failure this pins is the one the exponent-48 version had: every
    // wire live, every uniform moving, and the rendered result four orders of
    // magnitude below anything an eye can see.
    expect(sheen(0.34, 0.24, 0.6, 0.8, 3)).toBeGreaterThan(0.1)
  })
})

describe('the shaders', () => {
  // The GLSL and the TypeScript above are twins, and twins drift. Welding
  // them by text means a retune of one that forgets the other fails here
  // rather than in a screenshot nobody takes.
  it('steps the same arithmetic waveStep does', () => {
    expect(FIELD_SIM_FRAG).toContain('(2.0 * h - hPrev + uC2 * lap) * uDamping')
  })

  it('enters a drop as a depression after the step, never before it', () => {
    // Before the step it would be an offset the scheme has already accounted
    // for — a dent that sits there instead of a ripple that leaves.
    const stepAt = FIELD_SIM_FRAG.indexOf('float next =')
    const dropAt = FIELD_SIM_FRAG.indexOf('next -=')
    expect(stepAt).toBeGreaterThan(-1)
    expect(dropAt).toBeGreaterThan(stepAt)
  })

  it('clamps its neighbour fetches so the field has walls, not a seam', () => {
    expect(FIELD_SIM_FRAG).toContain('max(vUv.x - uTexel.x, 0.0)')
    expect(FIELD_SIM_FRAG).toContain('min(vUv.y + uTexel.y, 1.0)')
  })

  it('re-encodes the page it samples', () => {
    // The hard rule for every raw shader that samples a Surface texture: the
    // texture is sRGB, the sampler hands the shader linear values, and a raw
    // shader that forgets to re-encode writes linear into an sRGB canvas —
    // every antialiased midtone sinks and the text goes heavy, with nothing
    // to catch it but an eye that already knows.
    expect(PAGE_FRAG.trimEnd().endsWith('}')).toBe(true)
    expect(PAGE_FRAG).toContain('#include <colorspace_fragment>')
    const emit = PAGE_FRAG.indexOf('gl_FragColor =')
    expect(PAGE_FRAG.indexOf('#include <colorspace_fragment>')).toBeGreaterThan(emit)
  })

  it('lights the page with the same slope law sheen() states', () => {
    expect(PAGE_FRAG).toContain('float lit = max(dot(n.xy, uLight), 0.0);')
    expect(PAGE_FRAG).toContain('float spec = uSpecular * lit * lit;')
  })

  it('seeds a drop that is round on any window', () => {
    // Texel space, because the field's texels are square in screen pixels;
    // the same radius in uv would be an ellipse on every window that is not.
    expect(FIELD_SIM_FRAG).toContain('length((vUv - uDrop.xy) / uTexel)')
  })

  it('never brightens a pixel the page left empty', () => {
    // Both additive terms sit on a premultiplied colour, so each has to be
    // scaled by alpha or it paints light onto transparency.
    expect(PAGE_FRAG).toContain('spec * page.a')
    expect(PAGE_FRAG).toContain('* page.a;')
    expect(PAGE_FRAG).toContain('band * 0.07 * vec3(0.72, 0.9, 1.0) * page.a')
  })

  it('measures the front in pixels, so its wobble is round on a wide screen', () => {
    // Displacement and edge distance both convert through uPxToUv rather than
    // living in raw uv, where the same number is a wider wobble across than
    // down on every screen that is not square.
    expect(PAGE_FRAG).toContain('n.xy * uRefract * uPxToUv')
    expect(PAGE_FRAG).toContain('(vUv - uFront.xy) / uPxToUv')
  })

  it('warps the front by the field rather than sweeping a plain circle', () => {
    expect(PAGE_FRAG).toContain('uFront.z - h * uEdge.x')
  })

  it('drops the arriving page outside the front instead of fading it', () => {
    // The arriving quad stands in FRONT of the page it replaces, so only a
    // fragment that writes nothing lets the other one through.
    expect(PAGE_FRAG).toContain('discard')
  })

  it('shades the departing page AHEAD of the front, where it can be seen', () => {
    // The side behind the front is covered by the page arriving there, so a
    // shade applied to it is arithmetic that can never render a pixel. This
    // is that bug, pinned: the departing page's term must key on the outside
    // of the edge, not the inside.
    const cut = PAGE_FRAG.indexOf('if (uCut > 0.5)')
    const departing = PAGE_FRAG.slice(PAGE_FRAG.indexOf('} else {', cut))
    expect(departing).toContain('1.0 - smoothstep(0.0, 95.0, edge)')
    expect(departing).not.toContain('smoothstep(-9.0')
  })

  it('costs nothing at rest', () => {
    // Every front branch hangs off one uniform, which is 0 whenever the page
    // is not in transition — so a settled page is a plain textured quad.
    expect(PAGE_FRAG).toContain('if (uFrontOn > 0.5)')
  })
})
