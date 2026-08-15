// The two clauses a shared GLSL block needs, neither of which typecheck
// or lint can see. A shader is a string here and a program only in the
// browser, so a redeclared uniform is a black canvas at runtime and
// nothing at all before it.

import { describe, expect, it } from 'vitest'
import { LETTER_FRAG, LETTER_VERT } from './logoShaders'
import { FIELD_DS } from './logoFields'

/** GLSL with comments removed — these clauses are about code, and the
 *  comments around it name the same identifiers on purpose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** Every `uniform <type> <name>;` a source declares, in order. */
function uniforms(src: string): string[] {
  return [...src.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1])
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

  it('reads the field scales from logoFields rather than repeating them', () => {
    // uFieldPx converts a per-texel gradient into px of rise per px of
    // run. The two fields measure their run in different-sized texels,
    // so the numbers must come from the pyramid that made them.
    expect(LETTER_FRAG).toContain('uniform vec2 uFieldPx')
    expect(FIELD_DS).toEqual({ fine: 4, coarse: 16 })
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

  it('keeps every direction of the studio lit', () => {
    // A perceptual floor on the environment itself. The crease where
    // two bulged strokes meet and the fillet of an extruded arris
    // sweep their normals between the softboxes, and the bare room is
    // the only light those fragments get — the key's N.L is zero
    // there, and metal has no diffuse to fall back on. With the room's
    // low grade at 0.035 the darkest visible direction measured 0.041
    // at foil roughness — ~8/255 after tonemap, a black crack drawn
    // along every corner of the extruded letters (2026-08-14).
    //
    // The clause rebuilds the room from the shader's own constants and
    // sweeps it, so retuning the studio moves these numbers loudly.
    const src = code(LETTER_FRAG)
    const grade = /mix\(vec3\(([^)]+)\), vec3\(([^)]+)\), smoothstep\(-0\.8, 0\.5, d\.y\)\)/.exec(
      src,
    )!
    const ceiling = /vec3\(([^)]+)\) \* smoothstep\(0\.1, 1\.0, d\.y\)/.exec(src)!
    const boxes = [
      ...src.matchAll(/softbox\(d, normalize\(vec3\(([^)]+)\)\), ([\d.]+), vec3\(([^)]+)\), rg\)/g),
    ]
    expect(boxes).toHaveLength(3)

    const vec = (s: string) => s.split(',').map(Number) as [number, number, number]
    type V3 = [number, number, number]
    const norm = (v: V3): V3 => {
      const l = Math.hypot(...v)
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    const lo = vec(grade[1])
    const hi = vec(grade[2])
    const ceil = vec(ceiling[1])
    const lobes = boxes.map((b) => ({ dir: norm(vec(b[1])), sz: Number(b[2]), tint: vec(b[3]) }))
    const studio = (d: V3, rg: number) => {
      const g = smooth(-0.8, 0.5, d[1])
      const c = smooth(0.1, 1.0, d[1])
      const col: V3 = [0, 1, 2].map((i) => lo[i] + (hi[i] - lo[i]) * g + ceil[i] * c) as V3
      for (const { dir, sz, tint } of lobes) {
        const s = sz + rg * 0.5
        const e = Math.exp((dot(d, dir) - 1) / Math.max(s * s, 1e-4))
        for (let i = 0; i < 3; i++) col[i] += tint[i] * e
      }
      return col
    }
    const luma = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

    // Fibonacci sweep of the directions a viewer can meet — a tilted
    // letter shows normals a little past the profile, hence z >= -0.25.
    const min = (rg: number) => {
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
    // Foil roughness: between the tight lobes the room is all there
    // is, and it has to stay near the plate's own ink (22/255) rather
    // than fall to a crack. Measured 0.0955 at the shipped grade.
    expect(min(0.2)).toBeGreaterThanOrEqual(0.08)
    // Diffuse convolution: the darkest shadow side of a matte letter
    // keeps a visible fraction of the front face. Measured 19.8%.
    expect(min(1.0)).toBeGreaterThanOrEqual(0.18 * luma(studio([0, 0, 1], 1.0)))
  })
})
