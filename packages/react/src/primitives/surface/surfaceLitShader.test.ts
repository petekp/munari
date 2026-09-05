// @vitest-environment happy-dom
// SurfaceLitMaterial.onBeforeCompile splice — the double-premultiply guard.
//
// Three's `premultiplied_alpha_fragment` runs `gl_FragColor.rgb *=
// gl_FragColor.a` immediately before the splice's `#include
// <dithering_fragment>` anchor in meshphysical. The splice must scale the
// final fragment by the corner mask ALONE — a second `*= gl_FragColor.a`
// would double-premultiply translucent `alpha = 'source'` edges, darkening
// them by an extra factor of the source alpha. These guards fold three's
// chunk into the spliced source and reject any `*= gl_FragColor.a` AFTER
// that chunk: a mechanistic pin independent of which `alpha` configuration a
// consumer later mounts. No WebGL context is needed — `onBeforeCompile`
// operates on GLSL strings, so the splice is asserted textually against the
// real program source three hands a `MeshStandardMaterial`.

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  type ShaderStage,
  type SurfaceMaterialUniforms,
  spliceSurfaceLitShader,
} from './surfaceMaterials'

// Three's own premultiply chunk, folded in place of its `#include` token so
// the chunk's legitimate `*= gl_FragColor.a` is accounted for and the only
// `*=` statements that remain AFTER it are the splice's appended tail.
const PREMULTIPLY_CHUNK = THREE.ShaderChunk.premultiplied_alpha_fragment

function splicedFragment(): string {
  const value: SurfaceMaterialUniforms = {
    radii: { value: new THREE.Vector4(4, 4, 4, 4) },
    size: { value: new THREE.Vector2(200, 100) },
  }
  const shader: ShaderStage = {
    uniforms: {},
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  }
  spliceSurfaceLitShader(shader, value)
  return shader.fragmentShader
}

describe('SurfaceLitMaterial.onBeforeCompile splice', () => {
  it('un-premultiplies the capture before lighting and re-masks with the mask alone', () => {
    // The splice divides alpha out at `map_fragment` so lighting runs against
    // straight color, then attenuates the final fragment by the corner mask
    // at `dithering_fragment` — three's premultiply (the chunk directly above
    // that anchor) is the only `*= a` in the program.
    const frag = splicedFragment()
    expect(frag).toContain(
      'if ( diffuseColor.a > 0.0 ) diffuseColor.rgb /= diffuseColor.a;',
    )
    const unpremul = frag.indexOf('diffuseColor.rgb /= diffuseColor.a;')
    const remask = frag.indexOf('gl_FragColor.rgb *= munariMask;')
    expect(unpremul).toBeGreaterThan(-1)
    expect(remask).toBeGreaterThan(-1)
    expect(unpremul).toBeLessThan(remask)
  })

  it('applies one mask sample to both channels, premultiplied-equal', () => {
    // The mask is sampled ONCE and reused for alpha and rgb, so both channels
    // attenuate by the same factor and the fragment stays premultiplied for
    // whatever blend three selects.
    const frag = splicedFragment()
    expect(frag).toContain('float munariMask = munariRadiusMask( vUv );')
    expect(frag).toContain('gl_FragColor.a *= munariMask;')
    expect(frag).toContain('gl_FragColor.rgb *= munariMask;')
    const calls = frag.match(/munariRadiusMask\( vUv \)/g)
    expect(calls).toHaveLength(1)
  })

  it('does not re-multiply rgb by alpha after three premultiplies', () => {
    // Three's premultiply is behind its unresolved include token at splice
    // time, so the spliced string carries `*= gl_FragColor.a;` ONLY if the
    // splice wrote it. The buggy splice did; the fix must not.
    expect(splicedFragment()).not.toContain('gl_FragColor.rgb *= gl_FragColor.a;')
  })

  it('has no `*= gl_FragColor.a` anywhere after three\'s premultiply block', () => {
    // Fold three's own chunk in place of its include token. Everything after
    // the chunk is the tail the splice owns (the dithering anchor + the
    // appended lines + the closing brace). The tail must scale by the mask,
    // not by alpha — the mechanistic double-premultiply guard, which would
    // catch the bug regardless of which `alpha` regime a consumer mounts.
    const folded = splicedFragment().replace(
      '#include <premultiplied_alpha_fragment>',
      PREMULTIPLY_CHUNK,
    )
    const anchor = folded.indexOf(PREMULTIPLY_CHUNK)
    expect(anchor).toBeGreaterThan(-1)
    const tail = folded.slice(anchor + PREMULTIPLY_CHUNK.length)
    expect(tail).not.toMatch(/gl_FragColor\.rgb\s*\*=\s*gl_FragColor\.a/)
    // Positive: the single mask attenuate is what DOES follow three's
    // premultiply, keeping the fragment premultiplied for the blend.
    expect(tail).toContain('gl_FragColor.rgb *= munariMask;')
  })
})
