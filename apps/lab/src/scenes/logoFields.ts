// The blur pyramid behind the matter shader (logoShaders): each lifted
// letter carries two PRE-BLURRED copies of its own live texture — a
// fine field at 1/4 of the CSS box and a coarse field at 1/16 — and the
// shader reads geometry (shoulder, pillow, thickness, halo) from those
// instead of point-sampling the raw mask. A handful of taps at a wide
// radius does not blur, it copies (the ghost-trail screenshots,
// 2026-08-14); a real downsample chain is band-limited by construction,
// and hardware bilinear over the small targets hands the shader smooth
// gradients everywhere.
//
// Two deliberate choices:
//   · sizes ride the CSS box, not the texture — a LOD tier swap changes
//     the source, never the fields, so the substance look is identical
//     on every tier;
//   · values stay premultiplied and linear end to end (decisions.md #5)
//     — render targets are storage, not screen, so the blit pass has no
//     colorspace include.
//
// The passes run inside the material's own frame write, only on frames
// where the substance is actually lit (uFx > 0) — a parked or cooling
// letter costs nothing, which keeps the idle-zero stance intact.

import * as THREE from 'three'
import { BLIT_VERT, DOWN_FRAG } from './logoShaders'

/** Downsample factors of the two fields, relative to the CSS box.
 *  Fine sets the edge-shoulder scale (~4px blur, gradients spanning
 *  ~8px); coarse the pillow scale (~16px footprint, gradients spanning
 *  ~32px) — the pair the MATTER_PARAMS weights blend between. */
export const FIELD_DS = { fine: 4, coarse: 16 }

// One shared blit rig per module (one canvas on this page): a
// matrix-free fullscreen quad and the tent-filter material.
let rig: {
  scene: THREE.Scene
  camera: THREE.Camera
  material: THREE.ShaderMaterial
} | null = null

function ensureRig() {
  if (rig) return rig
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null as THREE.Texture | null },
      uSrcTexel: { value: new THREE.Vector2(1e-3, 1e-3) },
      uSpread: { value: 2 },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: DOWN_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  rig = { scene, camera: new THREE.Camera(), material }
  return rig
}

function makeTarget(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
}

/** The two height fields of one letter. Owned by MatterLetter (sized
 *  off the capture box, remade only when the box itself reallocates)
 *  and refreshed by MatterMaterial on lit frames. */
export class LetterFields {
  readonly fine: THREE.WebGLRenderTarget
  readonly coarse: THREE.WebGLRenderTarget

  constructor(boxW: number, boxH: number) {
    this.fine = makeTarget(
      Math.max(Math.round(boxW / FIELD_DS.fine), 8),
      Math.max(Math.round(boxH / FIELD_DS.fine), 8),
    )
    this.coarse = makeTarget(
      Math.max(Math.round(boxW / FIELD_DS.coarse), 4),
      Math.max(Math.round(boxH / FIELD_DS.coarse), 4),
    )
  }

  /** Two tent-filtered hops: src → fine → coarse. ~6k texels total, so
   *  refreshing every lit frame (the twin's color keeps easing after a
   *  beat) is cheaper than deciding when not to. */
  update(renderer: THREE.WebGLRenderer, src: THREE.Texture) {
    const img = src.image as { width: number; height: number } | undefined
    if (!img || !img.width) return
    const { scene, camera, material } = ensureRig()
    const u = material.uniforms
    const prev = renderer.getRenderTarget()
    u.tSrc.value = src
    u.uSpread.value = 2
    u.uSrcTexel.value.set(1 / img.width, 1 / img.height)
    renderer.setRenderTarget(this.fine)
    renderer.render(scene, camera)
    u.tSrc.value = this.fine.texture
    u.uSrcTexel.value.set(1 / this.fine.width, 1 / this.fine.height)
    renderer.setRenderTarget(this.coarse)
    renderer.render(scene, camera)
    renderer.setRenderTarget(prev)
  }

  dispose() {
    this.fine.dispose()
    this.coarse.dispose()
  }
}

// ── the outline readback ────────────────────────────────────────────────
//
// One shared target and one shared buffer, because the reads are
// sequential: a letter asks for its own alpha, traces it (logoContour),
// and is done before the next letter asks. Sharing keeps a rebuild from
// allocating a megabyte per letter.

let readback: {
  target: THREE.WebGLRenderTarget
  rgba: Uint8Array
  alpha: Uint8Array
} | null = null

/**
 * The letter's alpha, resampled to `w × h` and pulled back to the CPU
 * so the outline law can trace it.
 *
 * Two costs worth naming. This BLOCKS: `readRenderTargetPixels` drains
 * the pipeline, so it belongs on a shape change and nowhere near a
 * per-frame path. And the returned array is the shared buffer — read it
 * before calling again, never keep it.
 *
 * The blit is a tent filter at half the downsample stride, which is
 * what band-limits the alpha before it is traced: without it the
 * outline would inherit the source's own aliasing as permanent bumps in
 * the geometry. Rows come back bottom-up, which is the order
 * `traceContour` documents.
 */
export function readAlphaField(
  renderer: THREE.WebGLRenderer,
  src: THREE.Texture,
  w: number,
  h: number,
): Uint8Array | null {
  const img = src.image as { width: number; height: number } | undefined
  if (!img || !img.width || w < 2 || h < 2) return null
  if (!readback || readback.target.width !== w || readback.target.height !== h) {
    readback?.target.dispose()
    readback = {
      target: makeTarget(w, h),
      rgba: new Uint8Array(w * h * 4),
      alpha: new Uint8Array(w * h),
    }
  }
  const { scene, camera, material } = ensureRig()
  const u = material.uniforms
  const prev = renderer.getRenderTarget()
  u.tSrc.value = src
  u.uSrcTexel.value.set(1 / img.width, 1 / img.height)
  u.uSpread.value = Math.max(1, img.width / w / 2)
  renderer.setRenderTarget(readback.target)
  renderer.render(scene, camera)
  renderer.readRenderTargetPixels(readback.target, 0, 0, w, h, readback.rgba)
  renderer.setRenderTarget(prev)
  const { rgba, alpha } = readback
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
  return alpha
}
