// The blur pyramid behind the material shader (logoNodes): each lifted
// letter carries three PRE-BLURRED copies of its own live texture — a
// fine field at 1/4 of the CSS box, a coarse field at 1/16, and a halo
// field at 1/32 — and the shader reads geometry (shoulder, pillow,
// thickness, halo) from those instead of point-sampling the raw mask.
// A handful of taps at a wide radius does not blur, it copies (the
// ghost-trail screenshots, 2026-08-14); a real downsample chain is
// band-limited by construction, and hardware bilinear over the small
// targets hands the shader smooth gradients everywhere.
//
// Two deliberate choices:
//   · sizes ride the CSS box, not the texture — a LOD tier swap changes
//     the source, never the fields, so the substance look is identical
//     on every tier;
//   · values stay premultiplied and linear end to end (decisions.md #5)
//     — render targets are storage, not screen, so the blit pass writes
//     raw values and the renderer applies no output transform to them.
//
// The passes run inside the material's own frame write, only on frames
// that use the fields (light, relief or extrusion above zero on a
// non-ink material) — a parked or cooled letter costs nothing, which
// keeps the idle-zero stance intact.

import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import { createDownPass, type DownPass } from './logoNodes'
import { readTargetRows } from '../../lib/passTargets'

/** Downsample factors of the fields, relative to the CSS box. Fine
 *  sets the edge-shoulder scale (~4px blur, gradients spanning ~8px);
 *  coarse the pillow scale (~16px footprint, gradients spanning ~32px)
 *  — the pair the MATERIAL_PARAMS weights blend between. Halo is the
 *  glow's skirt (~64px of falloff): height and slope never read it,
 *  only the emissive halo does, because a glow that ends at the coarse
 *  field's ~32px support edge ends visibly — light has no edges. */
export const FIELD_DS = { fine: 4, coarse: 16, halo: 32 }

// One shared blit rig per module (one canvas on this page): a
// matrix-free fullscreen quad and the tent-filter material. The pass's
// source node is built around the first source it is handed, and every
// hop writes its `value`.
let rig: {
  scene: THREE.Scene
  camera: THREE.Camera
  pass: DownPass
} | null = null

function ensureRig(src: THREE.Texture) {
  if (rig) return rig
  const pass = createDownPass(texture(src))
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pass.material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  // The quad ignores the camera's matrices, but WebGPURenderer calls
  // updateProjectionMatrix() on any camera it renders with, and the base
  // Camera has none.
  rig = { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), pass }
  return rig
}

function makeTarget(w: number, h: number) {
  return new THREE.RenderTarget(w, h, {
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
}

/** Pixel dimensions of a texture source. All this rig wants from one. */
export interface Raster {
  width: number
  height: number
}

/**
 * The one boundary parse behind the fields. three types `Texture.image` as
 * `any` because the source can be a canvas, a bitmap, a video element, or
 * the plain `{ width, height }` a render target carries. Every one of them
 * reports its pixel size, and a texture that reports none is not one this
 * rig can sample from.
 */
export function raster(src: THREE.Texture | null | undefined): Raster | null {
  if (!src) return null
  // SAFETY: the guard on the next line is the parse. Nothing downstream
  // reads the value until both dimensions come back as real pixels.
  const image = src.image as Raster | undefined
  return image && image.width > 0 && image.height > 0 ? image : null
}

/** The blur pyramid of one letter. Owned by SceneLetter (sized off
 *  the capture box, remade only when the box itself reallocates) and
 *  refreshed by LetterMaterial on frames that use them. */
export class LetterFields {
  readonly fine: THREE.RenderTarget
  readonly coarse: THREE.RenderTarget
  readonly halo: THREE.RenderTarget

  constructor(boxW: number, boxH: number) {
    this.fine = makeTarget(
      Math.max(Math.round(boxW / FIELD_DS.fine), 8),
      Math.max(Math.round(boxH / FIELD_DS.fine), 8),
    )
    this.coarse = makeTarget(
      Math.max(Math.round(boxW / FIELD_DS.coarse), 4),
      Math.max(Math.round(boxH / FIELD_DS.coarse), 4),
    )
    this.halo = makeTarget(
      Math.max(Math.round(boxW / FIELD_DS.halo), 2),
      Math.max(Math.round(boxH / FIELD_DS.halo), 2),
    )
  }

  /** Three tent-filtered hops: src → fine → coarse → halo. Still ~6k
   *  texels total (the halo level is a quarter of the coarse one), so
   *  refreshing every lit frame (the twin's color keeps easing after a
   *  beat) is cheaper than deciding when not to. */
  update(renderer: WebGPURenderer, src: THREE.Texture) {
    const img = raster(src)
    if (!img) return
    const { scene, camera, pass } = ensureRig(src)
    const prev = renderer.getRenderTarget()
    pass.src.value = src
    pass.spread.value = 2
    pass.srcTexel.value.set(1 / img.width, 1 / img.height)
    renderer.setRenderTarget(this.fine)
    renderer.render(scene, camera)
    pass.src.value = this.fine.texture
    pass.srcTexel.value.set(1 / this.fine.width, 1 / this.fine.height)
    renderer.setRenderTarget(this.coarse)
    renderer.render(scene, camera)
    // The last hop is a 2× stride, not 4× — spread 1 already covers
    // every source texel at that stride, and spread 2 would double-blur.
    pass.src.value = this.coarse.texture
    pass.spread.value = 1
    pass.srcTexel.value.set(1 / this.coarse.width, 1 / this.coarse.height)
    renderer.setRenderTarget(this.halo)
    renderer.render(scene, camera)
    renderer.setRenderTarget(prev)
  }

  dispose() {
    this.fine.dispose()
    this.coarse.dispose()
    this.halo.dispose()
  }
}

// ── the outline readback ────────────────────────────────────────────────

/**
 * The letter's alpha, resampled to `w × h` and pulled back to the CPU
 * so the outline law can trace it: a fresh, tight `w × h` array, rows
 * from v = 0, the letter's bottom, which is the order `traceContour`
 * documents.
 *
 * It does not block. The render and the copy are queued before the
 * first await, so concurrent reads from several letters stay ordered;
 * what it costs is one extra pass, a GPU-to-CPU copy, and a target
 * allocated for this read alone — the result lands frames later. Still a
 * shape-change path, never a per-frame one.
 *
 * The blit is a tent filter at half the downsample stride, which is
 * what band-limits the alpha before it is traced: without it the
 * outline would inherit the source's own aliasing as permanent bumps in
 * the geometry.
 */
export async function readAlphaField(
  renderer: WebGPURenderer,
  src: THREE.Texture,
  w: number,
  h: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const img = raster(src)
  if (!img || w < 2 || h < 2) return null
  // Per read rather than shared: another letter's read at another size
  // would otherwise dispose the target this one is still copying from.
  const target = makeTarget(w, h)
  try {
    const { scene, camera, pass } = ensureRig(src)
    const prev = renderer.getRenderTarget()
    pass.src.value = src
    pass.srcTexel.value.set(1 / img.width, 1 / img.height)
    pass.spread.value = Math.max(1, img.width / w / 2)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const rows = readTargetRows(renderer, target)
    // Restored before the await: the rest of this frame must not render
    // into the readback target.
    renderer.setRenderTarget(prev)
    const rgba = await rows
    const alpha = new Uint8Array(w * h)
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
    return alpha
  } finally {
    target.dispose()
  }
}
