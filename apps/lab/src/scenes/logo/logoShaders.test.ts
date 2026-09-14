// Material rows must match the names dealt to the scene and remain valid shader inputs.
import { describe, expect, it } from 'vitest'
import { MATERIAL_PARAMS } from './logoShaders'
import { LOGO_MATERIALS } from './logoLaw'

describe('the material deck', () => {
  it('aligns one row with each name the law deals', () => {
    // The conductor deals indices into LOGO_MATERIALS (logoLaw) and the
    // letter feeds MATERIAL_PARAMS[index] to the shader. Nothing at
    // runtime checks that the two lists agree — a grown law with an
    // ungrown deck is an index out of range on the first re-deal. The
    // rows carry their names for exactly this clause.
    expect(MATERIAL_PARAMS.map((m) => m.name)).toEqual([...LOGO_MATERIALS])
  })

  it('keeps ink an absence, not a substance', () => {
    // Index 0 is the page's own look and the lit branch never opens
    // on it, so every number must be zero: a nonzero here is a look
    // nobody can see — until some refactor makes it one, loudly.
    const ink = MATERIAL_PARAMS[0]
    for (const [key, value] of Object.entries(ink)) {
      if (key === 'name') continue
      expect(value, `ink.${key}`).toBe(0)
    }
  })

  it('keeps every row inside the ranges the shader was built for', () => {
    // The surface channels are mix weights and the shape weights are
    // gains the height description was tuned around. A row outside
    // these boxes doesn't fail — it extrapolates, which is worse.
    for (const m of MATERIAL_PARAMS) {
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

})
