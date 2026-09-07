// Surface materials — the two the library ships, and the rule every custom
// one is held to.
//
// The law: a DOM-sourced texture is PREMULTIPLIED (decisions.md #5), so
// every material that samples one blends premultiplied. Unlit is the easy
// half — sample, mask, blend — and `<Surface.LitMaterial>` is the hard one:
// lighting is a multiply against straight color, so a premultiplied sample
// fed to it darkens exactly where it is translucent. The fix is to divide
// alpha out in the source's sRGB space before lighting. Three multiplies
// the final output by alpha; the corner mask then scales color and alpha.
//
// The fault behind the automatic configuration, 2026-08-15: a scene's own
// material sampled `useSurfaceTexture()` and left `premultipliedAlpha`
// alone. Three then blended SRC_ALPHA/ONE_MINUS_SRC_ALPHA over pixels whose
// color was already multiplied by alpha, which reads as a dark halo around
// every antialiased glyph — visible only against a light background, and
// invisible in review. A caller cannot be asked to remember the texture's
// alpha convention, so the presenter writes the flag onto whatever material
// it is handed.
//
// Ownership: this module owns material configuration and GLSL splices. It
// owns no texture, no mesh, and no protocol.

import { use, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SURFACE_RADIUS_GLSL } from '../../lib/surfaceRadiusGlsl'
import { SurfaceMaterialContext, useSurfaceTexture } from './surfaceContext'
import { getSurfaceLitTexture } from './surfaceLitTexture'

/** What a three shader looks like at `onBeforeCompile` time. */
interface ShaderStage {
  uniforms: Record<string, { value: unknown }>
  fragmentShader: string
}

// Filter premultiplied encoded channels first, then remove coverage and
// decode for lighting. Hardware sRGB decoding before filtering cannot be
// inverted afterward at a transparent edge (decision #48).
const STRAIGHT_SAMPLE_GLSL = `
uniform sampler2D uMunariEncodedMap;
vec4 munariStraightSample(vec4 sampleColor) {
  if (sampleColor.a <= 0.0) return vec4(0.0);
  sampleColor.rgb /= sampleColor.a;
  return sRGBTransferEOTF(sampleColor);
}
`

/**
 * Splice the corner mask into a fragment shader.
 *
 * `straight` decides where the mask lands: an unlit material multiplies it
 * into the sampled alpha and lets the ordinary blend carry it, while a lit
 * one has to wait for the final fragment — the lighting terms in between
 * would otherwise be computed for a fragment the mask is about to erase.
 */
function spliceRadiusMask(shader: ShaderStage, value: SurfaceMaterialUniforms) {
  shader.uniforms.uMunariRadii = value.radii
  shader.uniforms.uMunariSize = value.size
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <clipping_planes_pars_fragment>',
    '#include <clipping_planes_pars_fragment>\n' + SURFACE_RADIUS_GLSL,
  )
}

interface SurfaceMaterialUniforms {
  radii: { value: THREE.Vector4 }
  size: { value: THREE.Vector2 }
}

/**
 * The three uniforms every custom Surface shader needs, under the names
 * `SURFACE_RADIUS_GLSL` declares (`tMap` is this hook's naming for the
 * capture — the GLSL mask reads only the other two).
 */
export interface SurfaceUniforms {
  /** The live capture, premultiplied (decisions.md #5). */
  tMap: { value: THREE.Texture }
  uMunariRadii: { value: THREE.Vector4 }
  uMunariSize: { value: THREE.Vector2 }
}

/**
 * The uniform set a custom `<Surface.Mesh material={…}>` shader wires.
 *
 * The radii and size slots are the PRESENTER's own uniform objects, shared
 * by reference — a chrome change is a value write into them, so a material
 * wired here tracks it with no re-render. A material that allocates its own
 * copies instead compiles fine and then never moves (the fault this hook
 * exists to make unwritable). Extra uniforms merge by spread:
 *
 *   const surface = useSurfaceUniforms()
 *   const uniforms = useMemo(() => ({ ...surface, uTime: { value: 0 } }), [surface])
 */
export function useSurfaceUniforms(): SurfaceUniforms {
  const texture = useSurfaceTexture()
  const slot = use(SurfaceMaterialContext)
  if (!slot) {
    throw new Error(
      'munari: useSurfaceUniforms() must be called from the `material` of a ' +
        '<Surface.Mesh>. It wires that presenter’s corner mask, so there is ' +
        'nothing for it to wire anywhere else.',
    )
  }
  // The slots live for the component's whole life and take new textures as
  // value writes: the objects' identity is what a mounted shaderMaterial
  // holds, and replacing them mid-life would leave the compiled program
  // reading the abandoned copies.
  const tMap = useRef({ value: texture }).current
  tMap.value = texture
  return useMemo<SurfaceUniforms>(
    () => ({ tMap, uMunariRadii: slot.radii, uMunariSize: slot.size }),
    [slot, tMap],
  )
}

export interface SurfaceLitMaterialProps {
  /** Roughness of the slab the DOM is printed on. */
  roughness?: number
  metalness?: number
  /**
   * How much of the capture is emitted rather than lit. `0` is pure lit
   * matter; raising it lets a source's own bright pixels — an LED readout,
   * a backlit panel — keep their brightness under a dim scene light.
   */
  emissiveIntensity?: number
  side?: THREE.Side
}

/**
 * A lit slab wearing the Surface's capture.
 *
 * Mounted in `<Surface.Mesh material={…}>`, where a configured texture is
 * guaranteed to already exist. The emissive slot always carries the capture
 * so sliding `emissiveIntensity` is a uniform write rather than a program
 * change — at the default `0` the term contributes nothing.
 */
export function SurfaceLitMaterial({
  roughness = 0.55,
  metalness = 0,
  emissiveIntensity = 0,
  side,
}: SurfaceLitMaterialProps) {
  const texture = useSurfaceTexture()
  const litTexture = useMemo(() => getSurfaceLitTexture(texture), [texture])
  useLayoutEffect(() => litTexture.acquire(), [litTexture])
  const slot = use(SurfaceMaterialContext)
  if (!slot) {
    throw new Error(
      'munari: <Surface.LitMaterial> must be the `material` of a <Surface.Mesh>. ' +
        'It reads that presenter’s corner mask and alpha policy, so there is ' +
        'nothing for it to describe on its own.',
    )
  }

  // Identical source text across every instance on purpose: three keys its
  // program cache on this function's `toString`, so all lit Surfaces share
  // one compiled program while each wires its own uniform objects.
  const onBeforeCompile = useMemo(
    () => (shader: ShaderStage) => {
      spliceRadiusMask(shader, slot)
      shader.uniforms.uMunariEncodedMap = { value: litTexture.texture }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <clipping_planes_pars_fragment>',
          '#include <clipping_planes_pars_fragment>\n' + STRAIGHT_SAMPLE_GLSL,
        )
        .replace(
          '#include <map_fragment>',
          THREE.ShaderChunk.map_fragment.replace(
            'texture2D( map, vMapUv )',
            'texture2D( uMunariEncodedMap, vMapUv )',
          ).replace(
            'diffuseColor *= sampledDiffuseColor;',
            'diffuseColor *= munariStraightSample(sampledDiffuseColor);',
          ),
        )
        .replace(
          '#include <emissivemap_fragment>',
          THREE.ShaderChunk.emissivemap_fragment.replace(
            'texture2D( emissiveMap, vEmissiveMapUv )',
            'texture2D( uMunariEncodedMap, vEmissiveMapUv )',
          ).replace(
            'totalEmissiveRadiance *= emissiveColor.rgb;',
            'totalEmissiveRadiance *= munariStraightSample(emissiveColor).rgb;',
          ),
        )
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n' +
            // Three's premultiplied_alpha_fragment already applied source
            // coverage. Apply only the additional corner coverage here.
            '  gl_FragColor *= munariRadiusMask( vUv );\n' +
            '  if ( gl_FragColor.a < 0.004 ) discard;\n',
        )
    },
    [slot, litTexture],
  )

  return (
    <meshStandardMaterial
      map={texture}
      emissiveMap={texture}
      emissive="#ffffff"
      emissiveIntensity={emissiveIntensity}
      roughness={roughness}
      metalness={metalness}
      side={side}
      transparent={slot.transparent}
      premultipliedAlpha
      defines={{ USE_UV: '' }}
      onBeforeCompile={onBeforeCompile}
      onBeforeRender={litTexture.sync}
    />
  )
}

/**
 * Hold an arbitrary material to the library's alpha convention.
 *
 * Called on the mesh's live material after every commit, because the object
 * in the slot can be replaced by a re-render, by a `useMemo` dependency
 * changing, or by a scene swapping materials per frame — and a material
 * that reaches the renderer once with straight blending has already drawn
 * the fringe. Nothing else about the caller's material is touched.
 */
export function configureSurfaceMaterial(material: THREE.Material | THREE.Material[]): void {
  const list = Array.isArray(material) ? material : [material]
  for (const entry of list) {
    if (entry.premultipliedAlpha) continue
    entry.premultipliedAlpha = true
    entry.needsUpdate = true
  }
}
