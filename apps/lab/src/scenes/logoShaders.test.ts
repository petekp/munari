// The two clauses a shared GLSL block needs, neither of which typecheck
// or lint can see. A shader is a string here and a program only in the
// browser, so a redeclared uniform is a black canvas at runtime and
// nothing at all before it.

import { describe, expect, it } from 'vitest'
import { LETTER_FRAG, LETTER_VERT, MATTER_PARAMS } from './logoShaders'
import { FIELD_DS } from './logoFields'
import { LOGO_DEFAULTS, LOGO_MATTERS, RIPPLE, WEAVE, lightDir } from './logoLaw'

/** GLSL with comments removed — these clauses are about code, and the
 *  comments around it name the same identifiers on purpose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** Every `uniform <type> <name>;` a source declares, in order — the
 *  optional `[n]` covers the strike buffer, the one array uniform. */
function uniforms(src: string): string[] {
  return [...src.matchAll(/^\s*uniform\s+\w+\s+(\w+)(?:\s*\[\d+\])?\s*;/gm)].map((m) => m[1])
}

// ── the studio, rebuilt from the shader's own constants ─────────────────
//
// Two clauses measure the studio (the all-directions sweep and the
// flat-mirror floor), so the parse-and-mirror lives here once. The
// gains are evaluated at their shipped identity of 1 — a clause below
// pins that the DEFAULTS really are 1 — and the key softbox stands
// where the default dials put uLight, through the same lightDir the
// uniform feed uses. Retuning the studio breaks a regex here on
// purpose: the mirror must be re-read, not assumed.
type V3 = [number, number, number]
const vec = (s: string): V3 => {
  const [x, y, z] = s.split(',').map(Number)
  return [x, y, z]
}
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const luma = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

function buildStudio() {
  const src = code(LETTER_FRAG)
  const grade =
    /mix\(vec3\(([^)]+)\), vec3\(([^)]+)\), smoothstep\(-0\.8, 0\.5, d\.y\)\) \* uRoom/.exec(src)!
  const ceiling = /vec3\(([^)]+)\) \* smoothstep\(0\.1, 1\.0, d\.y\) \* uRoom/.exec(src)!
  const boxes = [
    ...src.matchAll(
      /softbox\(d, (uLight|normalize\(vec3\(([^)]*)\)\)), ([\d.]+)(?: \* uKeySoft)?, vec3\(([^)]+)\) \* u\w+, rg\)/g,
    ),
  ]
  const keyDir = norm(lightDir(LOGO_DEFAULTS.lightYaw, LOGO_DEFAULTS.lightPitch))
  const lo = vec(grade[1])
  const hi = vec(grade[2])
  const ceil = vec(ceiling[1])
  const lobes = boxes.map((b) => ({
    dir: b[1] === 'uLight' ? keyDir : norm(vec(b[2])),
    sz: Number(b[3]),
    tint: vec(b[4]),
  }))
  const studio = (d: V3, rg: number): V3 => {
    const g = smooth(-0.8, 0.5, d[1])
    const c = smooth(0.1, 1.0, d[1])
    const chan = (i: number) => lo[i] + (hi[i] - lo[i]) * g + ceil[i] * c
    const col: V3 = [chan(0), chan(1), chan(2)]
    for (const { dir, sz, tint } of lobes) {
      const s = sz + rg * 0.5
      const e = Math.exp((dot(d, dir) - 1) / Math.max(s * s, 1e-4))
      for (let i = 0; i < 3; i++) col[i] += tint[i] * e
    }
    return col
  }
  // Fibonacci sweep of the directions a viewer can meet — a tilted
  // letter shows normals a little past the profile, hence z >= -0.25.
  const sweepMin = (rg: number) => {
    let worst = Infinity
    for (let i = 0; i < 50000; i++) {
      const y = 1 - (2 * i + 1) / 50000
      const r = Math.sqrt(1 - y * y)
      const th = i * 2.399963229728653
      const d: V3 = [r * Math.cos(th), y, r * Math.sin(th)]
      if (d[2] < -0.25) continue
      worst = Math.min(worst, luma(studio(d, rg)))
    }
    return worst
  }
  return { studio, boxes, sweepMin }
}

describe('the letter shaders', () => {
  for (const [name, src] of [
    ['vertex', LETTER_VERT],
    ['fragment', LETTER_FRAG],
  ] as const) {
    it(`declares each uniform exactly once in the ${name} stage`, () => {
      const seen = uniforms(src)
      const dupes = seen.filter((u, i) => seen.indexOf(u) !== i)
      expect(dupes).toEqual([])
    })

    it(`declares every uniform the ${name} stage names`, () => {
      // The other half of the same clause, and the one that was
      // missing: pulling declarations into a shared block can DROP one
      // as easily as duplicate it. Moving the height description out of
      // the two stages left tFine and tCoarse declared nowhere, both
      // stages failed to compile, and every letter went to a black
      // canvas — with nothing above this line to say so (2026-08-14).
      //
      // The check leans on the file's own naming: a uniform is `uThing`
      // or `tTexture`, and nothing else in these shaders is. Verified
      // exhaustively across the module at the time of writing.
      const declared = new Set(uniforms(src))
      const used = new Set(code(src).match(/\b[ut][A-Z]\w*/g) ?? [])
      expect([...used].filter((u) => !declared.has(u))).toEqual([])
    })
  }

  it('shades the wall and the face down one path', () => {
    // The extruded edge used to take an early return, which is a second
    // shader wearing the first one's name: everything the face gained
    // after that line, the edge did not. One exit means the two can
    // only ever diverge where the source says so, in a `wall` mix.
    const main = code(LETTER_FRAG).split('void main()')[1]
    expect(main.match(/gl_FragColor\s*=/g)).toHaveLength(1)
    expect(main).not.toContain('return;')
  })

  it('carries the wall depth to the stage that shades the joint', () => {
    // vWall is 0 at the top ring and 1 at the back. The fillet and the
    // wall's self-shading both need it, and neither is recoverable from
    // the normal — every fragment of one wall quad shares a normal.
    for (const src of [LETTER_VERT, LETTER_FRAG]) expect(src).toContain('varying float vWall')
    expect(code(LETTER_VERT)).toContain('vWall = 1.0 - onSheet')
  })

  it('shares one height description across both stages', () => {
    // Both stages must carry the block; the vertex displaces by the
    // height and the fragment lights its slope, and they can only agree
    // if they are reading the same coefficients.
    for (const src of [LETTER_VERT, LETTER_FRAG]) {
      expect(src).toContain('float letterHeight(')
      expect(src).toContain('vec2 letterSlope(')
      expect(src).toContain('const vec2 FIELD_H')
    }
  })

  it('shares one motion description across both stages', () => {
    // The gel weave used to live twice — vertex displacement and
    // fragment lighting slope, hand-kept in sync — and dials on two
    // copies of one field are drift with a deadline. MOTION_GLSL is
    // the one description: the vertex displaces by motionDisp and
    // remaps through motionStretch, the fragment lights motionSlope,
    // and both stages must carry the block for that to be true.
    for (const src of [LETTER_VERT, LETTER_FRAG]) {
      expect(src).toContain('vec3 motionDisp(')
      expect(src).toContain('vec2 motionSlope(')
      expect(src).toContain('vec2 motionStretch(')
    }
    expect(code(LETTER_VERT).split('void main()')[1]).toContain('motionDisp(')
    expect(code(LETTER_VERT).split('void main()')[1]).toContain('motionStretch(')
    expect(code(LETTER_FRAG).split('void main()')[1]).toContain('motionSlope(')
    // And the slope reaches the normal at FULL strength. A face-on
    // plane shows its z-motion almost only through lighting, so a
    // mute on wslope mutes the wave itself — the ×0.6 that once sat
    // here was half of the 2026-08-14 rumble. Amplitude belongs to
    // the dials and the law (WEAVE), never to a hidden factor.
    expect(code(LETTER_FRAG)).toContain('normalize(vec3(-slope - wslope, 1.0))')
  })

  it('rolls the weave as an orbit, so the paint carries it', () => {
    // The 2026-08-14 lesson, pinned: a face-on plane shows height
    // ONLY through lighting, and most of the deck is too matte to
    // light — so a height-only weave is invisible on most of the
    // word however it is tuned. The weave is a trochoid: surge in
    // the plane against heave out of it, a quarter turn apart, at
    // ONE radius. The surge is what moves the ink, which every
    // matter shows.
    //
    // Both halves of the orbit, at the same radius (orb) and a
    // quarter turn apart — sin into the plane, cos out of it.
    const motion = code(LETTER_VERT)
    expect(motion).toContain('vec2 orb = uJelly * WEAVE_MIX;')
    expect(motion).toContain('-orb.x * sin(a.x) * uWaveDir - orb.y * sin(a.y) * t')
    expect(motion).toContain('orb.x * cos(a.x) + orb.y * cos(a.y)')
    // And the lit slope is that same height's gradient — the chain
    // rule on the SAME orbit (d/dq of cos is -k sin), not a second
    // description of the surface.
    expect(motion).toContain('-orb.x * uWaveK.x * sin(a.x) * uWaveDir')
    // The weave phases in the WORD's frame. Per-letter phase salt is
    // what made six letters churn independently; only the glow pulse
    // still wants a private clock.
    expect(motion).toContain('vec2 qw = q + uWaveOrigin;')
    expect(code(LETTER_VERT)).not.toContain('uPhase')
  })

  it('floats every matter on one sea', () => {
    // Softness runs 0.1 (enamel) to 1 (gummy), so an unfloored sea
    // barely moves two thirds of the deck — six letters on private
    // waters, which is not a wave (2026-08-14). The law's floor lifts
    // the stiffest matter onto a visible share of the swell while
    // leaving softness room to mean something: gummy must still roll
    // deeper than chrome, or the deck stops saying anything.
    const soft = MATTER_PARAMS.map((m) => m.jelly).filter((j) => j > 0)
    const ride = (j: number) => WEAVE.floor + (1 - WEAVE.floor) * j
    expect(ride(Math.min(...soft))).toBeGreaterThanOrEqual(0.35)
    expect(ride(Math.min(...soft))).toBeLessThan(ride(Math.max(...soft)) * 0.6)
    // Ink is the page's own look and never rides at all — the feed
    // gates it before the floor can lift it off the paper.
    expect(MATTER_PARAMS[0].name).toBe('ink')
    expect(MATTER_PARAMS[0].jelly).toBe(0)
  })

  it('rings a strike outward and retires it', () => {
    // The strike buffer's contract: as many slots as the law deals
    // (RIPPLE.slots — Logo.tsx recycles by the same constant), a
    // causality gate so a slot cannot ring before its birth, and a
    // ring-down on uRipK.w so a dead slot costs an exp and nothing
    // else. uRipAmp carries knob × progress × matter softness, which
    // is what keeps a handoff's geometry exactly flat.
    const motion = code(LETTER_FRAG)
    expect(motion).toContain(`uniform vec4 uRipples[${RIPPLE.slots}];`)
    expect(motion).toContain('step(0.0, age)')
    expect(motion).toContain('exp(-age / uRipK.w)')
    expect(motion).toContain('uRipAmp * rp.w')
  })

  it("conserves the letter's area when travel stretches it", () => {
    // Squash-and-stretch reads as mass only while it conserves area:
    // long by 1 + s along the motion, thin by exactly 1 / (1 + s)
    // across it — and at uStretch 0 both factors are 1, so the remap
    // is the identity the handoff theorem requires, by arithmetic
    // rather than by branch.
    const motion = code(LETTER_FRAG)
    expect(motion).toContain('float along = 1.0 + uStretch;')
    expect(motion).toContain('* along)')
    expect(motion).toContain('/ along)')
  })

  it('reads the field scales from logoFields rather than repeating them', () => {
    // uFieldPx converts a per-texel gradient into px of rise per px of
    // run. The two fields measure their run in different-sized texels,
    // so the numbers must come from the pyramid that made them.
    expect(LETTER_FRAG).toContain('uniform vec2 uFieldPx')
    expect(FIELD_DS).toEqual({ fine: 4, coarse: 16, halo: 32 })
  })

  it('reproduces the shipped bump gains at the reference amplitude', () => {
    // The claim that makes this refactor safe to land: at
    // uRelief = RELIEF_REF the shared slope is arithmetically the gain
    // pair the bump-only letter was tuned on — 2.4 on the fine
    // gradient, 3.2 on the coarse — so the lighting does not move.
    // If FIELD_H or RELIEF_REF is retuned, this clause is the record
    // that the look changed on purpose.
    const ref = Number(/const float RELIEF_REF = ([\d.]+);/.exec(LETTER_FRAG)![1])
    const [fine, coarse] = /const vec2 FIELD_H = vec2\(([\d.]+), ([\d.]+)\);/
      .exec(LETTER_FRAG)!
      .slice(1)
      .map(Number)
    // letterSlope's coefficient, at uRelief = ref and uDome = 1.
    expect((ref / ref) * (fine / FIELD_DS.fine)).toBeCloseTo(2.4, 6)
    expect((ref / ref) * (coarse / FIELD_DS.coarse)).toBeCloseTo(3.2, 6)
  })

  it('keeps the fine shoulder out of the mesh', () => {
    // The sheet steps a vertex every 4 CSS px and the fine field has a
    // texel every 4 CSS px, so the grid samples that field exactly at
    // Nyquist. Displacing by it does not round the letter; it makes the
    // grid visible, and at the knob's ceiling — 29 px of alternating z
    // on a 4 px cell, foil and gummy at relief 60 — it shatters the
    // sheet into facets. So the mesh takes the coarse pillow and the
    // fragment lights the whole height regardless.
    expect(LETTER_VERT).toContain('float letterMeshHeight(')
    const main = code(LETTER_VERT).split('void main()')[1]
    expect(main).toContain('letterMeshHeight(texture2D(tCoarse, uv).a)')
    expect(main).not.toContain('tFine')
  })

  it('displaces every vertex of the slab, not only the sheet', () => {
    // The relief term carried an onSheet factor, which lifted the front
    // of the body and left its back pinned flat. The walls then leaned
    // by however far the surface above them had risen — up to 209 px
    // (balloon at relief 60) — while their baked normals still said
    // vertical, and the ones leaning inward turned away from the camera
    // and were culled, leaving holes through the letter (2026-08-14).
    // Displacing everything makes the slab a rigid extrusion of the
    // displaced outline, which is the only form its normals describe.
    const relief = /uRelief \* uMeshFrac > 0\.0\) \{([\s\S]*?)\n    \}/.exec(code(LETTER_VERT))![1]
    expect(relief).toContain('uMeshFrac')
    expect(relief).not.toContain('onSheet')
  })

  it('lights the whole height whatever share the mesh carries', () => {
    // The property the body knob rests on: uMeshFrac scales the VERTEX
    // displacement and nothing in the fragment. If it ever appears in
    // the fragment, sliding the knob would restyle the letter instead
    // of solidifying it.
    expect(code(LETTER_VERT).split('void main()')[1]).toContain('uMeshFrac')
    expect(code(LETTER_FRAG).split('void main()')[1]).not.toContain('uMeshFrac')
  })

  it('gives the solid letter one outline', () => {
    // The walls stand on the polygon traced from the committed
    // readback field (logoFields → logoContour), so the face and the
    // cap must harden onto that SAME field, uploaded as tTrace.
    // Hardening on the sharp texture's own alpha put two outlines on
    // one body: the traced field is band-limited and the sharp alpha
    // is not, and a blur moves an isoline at every curve — the gap
    // between the two showed the dark cap as a serrated ring inside
    // every counter, and the un-antialiasable hard step (texture, not
    // geometry — MSAA never sees it) drew stair-teeth along the bows
    // (2026-08-14). fwidth resolves the shared isoline to one screen
    // pixel of real antialiasing.
    const main = code(LETTER_FRAG).split('void main()')[1]
    expect(main).toContain('texture2D(tTrace, vUv)')
    expect(main).toContain('fwidth(cov)')
    // The sharp alpha stays a color source, never a silhouette.
    expect(main).not.toMatch(/c\.a - 0\.5/)
  })

  it('asks the deck row, never the index, what a surface is', () => {
    // The per-matter constants used to live in here as a branch
    // ladder, which made a substance a code path: growing the deck
    // meant editing the shader, and the panel's trims could never
    // reach a hardcoded number. The one test left on the index is
    // ink-versus-substance; everything else — roughness, metal,
    // subsurface, crinkle, sheen, iridescence, glow — arrives as the
    // deck row's uniforms, with the trims folded in by Logo.tsx.
    const main = code(LETTER_FRAG).split('void main()')[1]
    expect(main.match(/uMatter/g)).toHaveLength(1)
    expect(main).toContain('uMatter > 0.5')
  })

  it('gives the glow a two-lobe halo that dies before its fields do', () => {
    // "The falloff is way too sudden" (2026-08-14): the halo rode the
    // coarse field alone — support ends ~32 CSS px out — behind a
    // ×1.9 gain that saturated the inner half, so the entire visible
    // falloff happened in the last few px of that support: a
    // sticker's edge, not light. Two excesses an octave apart decay
    // into each other the way a bloom stack does; the uv fade retires
    // the skirt before the capture box can guillotine it; uFx keeps
    // the handoff identity (no halo at a swap) and uGlow keeps the
    // whole thing a dial rather than a neon flag.
    const main = code(LETTER_FRAG).split('void main()')[1]
    expect(main).toContain('texture2D(tHalo, vUv)')
    expect(main).toContain('max(thick - c.a, 0.0)')
    expect(main).toContain('max(hW.a - c.a, 0.0)')
    expect(main).toContain('uGlow > 0.001 && wall + back < 0.5')
    expect(main).toContain('uFx * uGlow * haloF')
    expect(main).not.toContain('* 1.9')
  })

  it('hands the painted edge to the walls as the slab opens', () => {
    // The fine gradient is the painted shoulder — zero inside the
    // glyph, steep only where the alpha ramps off. It is how a FLAT
    // letter fakes a rounded edge, and a solid letter draws that edge
    // with geometry instead. Left in, the edge is drawn twice, and
    // the painted copy is a band of near-in-plane normals that shades
    // as a dark line scribed along every corner (2026-08-14). uSolid
    // must retire the fine slope exactly as it hardens the alpha —
    // one ramp, one handover — and the coarse pillow stays: it is the
    // surface, not the edge.
    const main = code(LETTER_FRAG).split('void main()')[1]
    expect(main).toContain('letterSlope(gF * (1.0 - uSolid), gC)')
  })

  it('keeps every direction of the studio lit', () => {
    // A perceptual floor on the environment itself. The crease where
    // two bulged strokes meet and the fillet of an extruded arris
    // sweep their normals between the softboxes, and the bare room is
    // the only light those fragments get — the key's N.L is zero
    // there, and metal has no diffuse to fall back on. With the room's
    // low grade at 0.035 the darkest visible direction measured 0.041
    // at foil roughness — ~8/255 after tonemap, a black crack drawn
    // along every corner of the extruded letters (2026-08-14).
    const { studio, boxes, sweepMin } = buildStudio()
    // Room grade, ceiling, key, cool fill, floor bounce, front fill —
    // a box the regex no longer finds is a box this sweep no longer
    // guards, so the count is part of the contract.
    expect(boxes).toHaveLength(4)
    // Foil roughness: between the tight lobes the room is all there
    // is, and it has to stay near the plate's own ink (22/255) rather
    // than fall to a crack. Measured 0.0958 at the shipped rig.
    expect(sweepMin(0.2)).toBeGreaterThanOrEqual(0.08)
    // Diffuse convolution: the darkest shadow side of a matte letter
    // keeps a visible fraction of the front face. The rig (2026-08-14:
    // key twin onto uLight's more frontal default, plus the front
    // fill) brightened the FACE more than the shadow side — the
    // absolute floor rose 0.2275 → 0.2757 while the ratio fell 19.8%
    // → 15.6% — so the shadow side is pinned both ways: never below
    // 14% of the face, and never below 0.25 outright.
    expect(sweepMin(1.0)).toBeGreaterThanOrEqual(0.14 * luma(studio([0, 0, 1], 1.0)))
    expect(sweepMin(1.0)).toBeGreaterThanOrEqual(0.25)
  })

  it('gives a flat mirror something to reflect', () => {
    // "The letter goes completely black when gloss is all the way up"
    // (2026-08-14): chrome at metal 1 has no diffuse, and a FLAT sheet
    // of it reflects the view axis — where all three working boxes
    // never reach (key dot(+z) ≈ 0.59 against a mirror lobe of
    // s² ≈ 0.013 is e^-31). The letter rendered the bare room grade,
    // ~0.13, which tonemaps below the page ink #17170f — a hole shaped
    // like a letter. The front fill is the repair, and this is its
    // floor: the studio dead ahead, at the deck's own mirror
    // roughness, stays clearly brighter than the page. Measured
    // 0.4505 at the shipped rig.
    const { studio } = buildStudio()
    const mirrorRough = Math.min(
      ...MATTER_PARAMS.filter((m) => m.metal > 0.5).map((m) => m.rough),
    )
    expect(luma(studio([0, 0, 1], mirrorRough))).toBeGreaterThanOrEqual(0.4)
  })

  it('ships the rig at identity', () => {
    // buildStudio measures the studio with every gain at 1, so 1 must
    // be what actually ships — a default that drifts would quietly
    // move the look out from under every floor above.
    expect(LOGO_DEFAULTS.key).toBe(1)
    expect(LOGO_DEFAULTS.keySoft).toBe(1)
    expect(LOGO_DEFAULTS.fill).toBe(1)
    expect(LOGO_DEFAULTS.room).toBe(1)
    expect(LOGO_DEFAULTS.front).toBe(1)
  })
})

describe('the matter deck', () => {
  it('aligns one row with each name the law deals', () => {
    // The conductor deals indices into LOGO_MATTERS (logoLaw) and the
    // letter feeds MATTER_PARAMS[index] to the shader. Nothing at
    // runtime checks that the two lists agree — a grown law with an
    // ungrown deck is an index out of range on the first re-deal. The
    // rows carry their names for exactly this clause.
    expect(MATTER_PARAMS.map((m) => m.name)).toEqual([...LOGO_MATTERS])
  })

  it('keeps ink an absence, not a substance', () => {
    // Index 0 is the page's own look and the lit branch never opens
    // on it, so every number must be zero: a nonzero here is a look
    // nobody can see — until some refactor makes it one, loudly.
    const ink = MATTER_PARAMS[0]
    for (const [key, value] of Object.entries(ink)) {
      if (key === 'name') continue
      expect(value, `ink.${key}`).toBe(0)
    }
  })

  it('keeps every row inside the ranges the shader was built for', () => {
    // The surface channels are mix weights and the shape weights are
    // gains the height description was tuned around. A row outside
    // these boxes doesn't fail — it extrapolates, which is worse.
    for (const m of MATTER_PARAMS) {
      for (const key of ['rough', 'metal', 'sss', 'crinkle', 'sheen', 'irid', 'glow'] as const) {
        expect(m[key], `${m.name}.${key}`).toBeGreaterThanOrEqual(0)
        expect(m[key], `${m.name}.${key}`).toBeLessThanOrEqual(1)
      }
      for (const key of ['shoulder', 'pillow', 'dome', 'jelly', 'prism'] as const) {
        expect(m[key], `${m.name}.${key}`).toBeGreaterThanOrEqual(0)
        expect(m[key], `${m.name}.${key}`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('uses glow as a dial, not a neon flag', () => {
    // At least one matter glows fully and one glows PARTIALLY, so the
    // emissive path can never quietly regress to an is-neon branch —
    // the partial glower would go dark or go full tube, and this
    // clause names which.
    const glows = MATTER_PARAMS.map((m) => m.glow)
    expect(glows).toContain(1)
    expect(glows.some((g) => g > 0 && g < 1)).toBe(true)
  })
})
