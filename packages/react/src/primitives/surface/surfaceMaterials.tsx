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
// WebGPURenderer runs no GLSL, so these are node materials and custom
// materials are built from `useSurfaceNodes()` (decisions.md #71).
//
// Ownership: this module owns material configuration and the node graphs.
// It owns no texture, no mesh, and no protocol.

import { use, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { MeshStandardNodeMaterial, type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import { Discard, Fn, output, sRGBTransferEOTF, texture as textureNode, uniform, uv, vec3, vec4 } from 'three/tsl'
import { surfaceRadiusMask } from '../../lib/surfaceRadius'
import { SurfaceMaterialContext, useSurfaceTexture, type SurfaceMaterialValue } from './surfaceContext'
import { getSurfaceLitTexture } from './surfaceLitTexture'
import { isDevelopmentRuntime } from '../FrameSurface'

function useMaterialSlot(caller: string): SurfaceMaterialValue {
  const slot = use(SurfaceMaterialContext)
  if (!slot) {
    throw new Error(
      `munari: ${caller} must be used in the \`material\` of a <Surface.Mesh>. ` +
        'It reads that presenter’s corner mask and alpha policy, so there is ' +
        'nothing for it to describe on its own.',
    )
  }
  return slot
}

/** What a custom `<Surface.Mesh material={…}>` node material builds from. */
export interface SurfaceNodes {
  /**
   * The live capture, premultiplied (decisions.md #5). The node keeps its
   * identity when a resize replaces the texture, so a material built once
   * keeps sampling the current capture.
   */
  readonly map: TextureNode
  /** The presenter's corner radii in source CSS px: tl, tr, br, bl. */
  readonly radii: UniformNode<'vec4', THREE.Vector4>
  /** The source's CSS size. */
  readonly size: UniformNode<'vec2', THREE.Vector2>
  /**
   * Corner coverage, 1 inside and 0 outside, at `coordinates`: the mesh UV by
   * default. Multiply the whole premultiplied vec4 by it.
   */
  radiusMask(coordinates?: Node<'vec2'>): Node<'float'>
}

/**
 * The nodes a custom `<Surface.Mesh material={…}>` builds from.
 *
 * The radii and size are the PRESENTER's own uniform nodes, so a chrome
 * change is a value write the material sees with no re-render. The returned
 * object keeps its identity for the component's life, so a material can be
 * built from it once:
 *
 *   const surface = useSurfaceNodes()
 *   const material = useMemo(() => {
 *     const m = new MeshBasicNodeMaterial({ transparent: true })
 *     const sample = surface.map.sample(uv()).mul(surface.radiusMask())
 *     m.outputNode = premultipliedOutput(sample)
 *     return m
 *   }, [surface])
 *
 * Return the color through `premultipliedOutput`. A material that sets
 * `colorNode` instead multiplies the premultiplied capture by alpha again,
 * so translucent pixels land darker than the page (decisions.md #72).
 */
export function useSurfaceNodes(): SurfaceNodes {
  const capture = useSurfaceTexture()
  const slot = useMaterialSlot('useSurfaceNodes()')
  const nodes = useRef<SurfaceNodes | null>(null)
  let current = nodes.current
  if (!current || current.radii !== slot.radii) {
    const { radii, size } = slot
    current = {
      map: textureNode(capture),
      radii,
      size,
      radiusMask: (coordinates = uv()) => surfaceRadiusMask(coordinates, size, radii),
    }
    nodes.current = current
  }
  current.map.value = capture
  return current
}

export interface SurfaceLitMaterialProps {
  /** Roughness of the slab the DOM is printed on. */
  roughness?: number
  metalness?: number
  /**
   * How much of the capture is emitted rather than lit. `0` is pure lit
   * surface; raising it lets a source's own bright pixels — an LED readout,
   * a backlit panel — keep their brightness under a dim scene light.
   */
  emissiveIntensity?: number
  side?: THREE.Side
}

/**
 * A lit slab wearing the Surface's capture.
 *
 * Mounted in `<Surface.Mesh material={…}>`, where a configured texture is
 * guaranteed to already exist. The emissive term always carries the capture
 * so sliding `emissiveIntensity` is a uniform write rather than a rebuild —
 * at the default `0` it contributes nothing.
 */
export function SurfaceLitMaterial({
  roughness = 0.55,
  metalness = 0,
  emissiveIntensity = 0,
  side,
}: SurfaceLitMaterialProps) {
  const capture = useSurfaceTexture()
  const litTexture = useMemo(() => getSurfaceLitTexture(capture), [capture])
  useLayoutEffect(() => litTexture.acquire(), [litTexture])
  const slot = useMaterialSlot('<Surface.LitMaterial>')
  // Before each draw, after raster sizing: the raw view follows the capture.
  useLayoutEffect(() => slot.beforeDraw(litTexture.sync), [slot, litTexture])

  const emission = useMemo(() => uniform(0), [])
  // One node for the material's life: a resize replaces the raw view, and a
  // value write keeps the built material instead of rebuilding its shader.
  const [encoded] = useState(() => textureNode(litTexture.texture))
  encoded.value = litTexture.texture
  const material = useMemo(() => {
    const created = new MeshStandardNodeMaterial({ color: '#ffffff', premultipliedAlpha: true })
    // Filter premultiplied encoded channels first, then remove coverage and
    // decode for lighting. Hardware sRGB decoding before filtering cannot be
    // inverted afterward at a transparent edge (decisions.md #48).
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const sample = encoded.sample(uv()) as Node<'vec4'>
    const straight = sample.a.greaterThan(0).select(sample.rgb.div(sample.a), vec3(0))
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const linear = sRGBTransferEOTF(straight) as Node<'vec3'>
    created.colorNode = vec4(linear, sample.a)
    created.emissiveNode = linear.mul(emission)
    const mask = surfaceRadiusMask(uv(), slot.size, slot.radii)
    // Three's premultiplication already applied source coverage; this adds
    // only the corner coverage.
    created.outputNode = Fn(() => {
      const covered = output.mul(mask)
      Discard(covered.a.lessThan(0.004))
      return covered
    })()
    return created
  }, [encoded, emission, slot.size, slot.radii])
  useLayoutEffect(() => () => material.dispose(), [material])

  emission.value = emissiveIntensity
  material.roughness = roughness
  material.metalness = metalness
  const nextSide = side ?? THREE.FrontSide
  if (material.side !== nextSide || material.transparent !== slot.transparent) {
    material.side = nextSide
    material.transparent = slot.transparent
    material.needsUpdate = true
  }
  return <primitive object={material} attach="material" />
}

// A GLSL material compiles nowhere on WebGPURenderer: Three draws nothing
// and logs once per program, far from the Surface that caused it.
let reportedGlsl = false
function reportGlslMaterial(material: THREE.Material): void {
  if (reportedGlsl || !isDevelopmentRuntime()) return
  const glsl =
    material instanceof THREE.ShaderMaterial ||
    material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
  if (!glsl) return
  reportedGlsl = true
  console.error(
    'munari: a <Surface.Mesh> material uses GLSL (a ShaderMaterial or onBeforeCompile), which ' +
      'WebGPURenderer cannot run. Build a node material from useSurfaceNodes() instead.',
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
    reportGlslMaterial(entry)
    if (entry.premultipliedAlpha) continue
    entry.premultipliedAlpha = true
    entry.needsUpdate = true
  }
}
