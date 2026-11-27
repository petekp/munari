// Surface materials — the nodes a custom material builds from, and the rule
// every custom one is held to.
//
// The law: a DOM-sourced texture is PREMULTIPLIED (decisions.md #5), so
// every material that samples one blends premultiplied. Lighting is a
// multiply against straight color, so a premultiplied sample fed to it
// darkens exactly where it is translucent. The fix is to divide alpha out
// in the source's sRGB space before lighting, which `litMap` makes possible
// (decisions.md #48).
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

import { use, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { type Node, type TextureNode, type UniformNode } from 'three/webgpu'
import { texture as textureNode, uv } from 'three/tsl'
import { surfaceRadiusMask } from '../../lib/surfaceRadius'
import { SurfaceMaterialContext, useSurfaceTextureFor, type SurfaceMaterialValue } from './surfaceContext'
import { getSurfaceLitTexture, type SurfaceLitTexture } from './surfaceLitTexture'
import { isDevelopmentRuntime } from '../../lib/developmentRuntime'
import { reportedGlslMaterials, usesGlsl } from './glslMaterial'


export function useMaterialSlot(caller: string): SurfaceMaterialValue {
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
  /**
   * The same capture as a raw (NoColorSpace) view: encoded and premultiplied,
   * for a lit material. Divide the sample's rgb by its alpha, then decode with
   * `sRGBTransferEOTF`: decoding before the divide cannot be undone at a
   * transparent edge (decisions.md #48). Read it while building the material,
   * during render: the view is allocated only for a material that reads it.
   */
  readonly litMap: TextureNode
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
  const capture = useSurfaceTextureFor('useSurfaceNodes()')
  const slot = useMaterialSlot('useSurfaceNodes()')
  const nodes = useRef<SurfaceNodes | null>(null)
  const lit = useRef<{ readonly view: SurfaceLitTexture; readonly node: TextureNode } | null>(null)
  let current = nodes.current
  if (!current || current.radii !== slot.radii) {
    const { radii, size } = slot
    const map = textureNode(capture)
    current = {
      map,
      get litMap() {
        const view = getSurfaceLitTexture(map.value)
        lit.current ??= { view, node: textureNode(view.texture) }
        return lit.current.node
      },
      radii,
      size,
      radiusMask: (coordinates = uv()) => surfaceRadiusMask(coordinates, size, radii),
    }
    nodes.current = current
  }
  current.map.value = capture
  if (lit.current) {
    const view = getSurfaceLitTexture(capture)
    if (lit.current.view !== view) lit.current = { view, node: lit.current.node }
    lit.current.node.value = view.texture
  }
  // Before each draw, after raster sizing: the raw view follows the capture.
  // The material read `litMap` while it was built in this render, so the
  // record exists by this commit when it is wanted.
  useLayoutEffect(() => {
    const record = lit.current
    if (!record) return
    const { view, node } = record
    const release = view.acquire()
    const stop = slot.beforeDraw(() => {
      view.sync()
      node.value = view.texture
    })
    return () => {
      stop()
      release()
    }
  }, [capture, slot])
  return current
}

let reportedGlsl = false
function reportGlslMaterial(material: THREE.Material): void {
  if (reportedGlsl || reportedGlslMaterials.has(material) || !isDevelopmentRuntime() || !usesGlsl(material)) return
  reportedGlsl = true
  reportedGlslMaterials.add(material)
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
