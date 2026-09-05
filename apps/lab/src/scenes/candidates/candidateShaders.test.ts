// The candidates' shaders are strings until a browser compiles them, so
// the contract the folder documents lives here as regex the way the logo
// suite does it. SUCK_VERT computes a per-vertex normal to shade the
// flying copy mid-flight; commit c7f7806 wrote its x-component with a
// lone negation the height field does not justify, mirroring the shared
// LIGHT across x. See candidateShaders.ts SUCK_VERT.

import { describe, expect, it } from 'vitest'
import { RIPPLE_VERT, SUCK_VERT } from './candidateShaders'

/** GLSL with comments removed — matches the helper in logoShaders.test.ts,
 *  so the questions about code (not comments) carry across scenes. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

describe('candidateShaders — the SUCK_VERT normal matches the height field', () => {
  it('writes the symmetric outward normal (slope * dir.x, slope * dir.y, 1.0)', () => {
    // The outward normal of z(x,y) is (-dz/dx, -dz/dy, 1) = (-∇z, 1).
    // Here ∇z = -slope * dir, so (-∇z, 1) = (slope*dir.x, slope*dir.y, 1) —
    // BOTH horizontal components carry the SAME sign. Commit c7f7806 wrote
    // this with a lone negated x-term, mirroring the lighting across x:
    // the shared LIGHT.x = -0.34 hit the +x-facing side of each fold
    // instead of the -x-facing side. Pin the fixed form so a future
    // re-introduction of the flip trips the suite.
    expect(code(SUCK_VERT)).toMatch(
      /vNormal\s*=\s*normalize\(\s*vec3\(\s*slope\s*\*\s*dir\.x\s*,\s*slope\s*\*\s*dir\.y\s*,\s*1\.0\s*\)\s*\)\s*;/,
    )
  })

  it('does NOT contain the negated x-term the fix removed (-slope * dir.x)', () => {
    // The mirror of the clause above, naming the bug so the next reader
    // sees what was fixed without diffing the report.
    expect(code(SUCK_VERT)).not.toContain('-slope * dir.x')
  })

  it('RIPPLE_VERT keeps its justified asymmetry AND its y-flip comment', () => {
    // The convention the fix matches is the symmetric outward normal;
    // RIPPLE_VERT's (-grad.x, grad.y, 1.0) IS asymmetric, and that is
    // correct: it converts to content coordinates (y-down) before
    // computing the gradient, so the y-axis flip is a frame conversion,
    // not a sign error. A future "consistency" sweep that symmetrised
    // RIPPLE would be a regression; this clause pins both the asymmetry
    // and the comment that justifies it.
    expect(code(RIPPLE_VERT)).toContain('vNormal = normalize(vec3(-grad.x, grad.y, 1.0));')
    // The comment uses a plain ASCII apostrophe (0x27), not a curly one.
    expect(RIPPLE_VERT).toContain("Content y runs down; the world's runs up")
  })
})
