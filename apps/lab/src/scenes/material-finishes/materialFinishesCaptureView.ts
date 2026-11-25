// Raw capture view — a Surface capture uploaded as its encoded bytes, with
// no hardware sRGB decode, so a shader can composite or unpremultiply it
// before decoding.
//
// The law (decisions.md #48): the capture is premultiplied in its sRGB
// encoding, and hardware decoding runs before filtering, which cannot be
// undone at a transparent edge. On 2026-09-07 decoding first drew a white
// edge of 75/64 (RGB/alpha) where the opaque swatch needed 34/64.
// Surface.LitMaterial keeps a raw view for this, but the library does not
// export it, so this lab copy rebuilds it from public three APIs until a
// finish API owns it.
//
// Ownership: the view shares the capture canvas and owns its own Texture and
// GPU storage. Its upload calls the capture's `onUpdate`, because the
// presenter's post-draw receipt listens there and this material never draws
// the sRGB view. The capture's runtime still owns painting.

import * as THREE from 'three'

export interface RawCaptureView {
  readonly texture: THREE.Texture
  /** Follow the capture's canvas, sampler and version. Run before each draw. */
  sync(): void
  /** Free the GPU storage. A later `sync` uploads again. */
  dispose(): void
}

function captureCanvas(capture: THREE.Texture): HTMLCanvasElement {
  const image: unknown = capture.image
  if (!(image instanceof HTMLCanvasElement)) {
    throw new Error('material-finishes: the Surface capture has no canvas to view.')
  }
  return image
}

/** Copy the capture's sampler state; true when the GPU texture must re-upload. */
function copySampler(capture: THREE.Texture, view: THREE.Texture): boolean {
  const changed =
    view.wrapS !== capture.wrapS ||
    view.wrapT !== capture.wrapT ||
    view.minFilter !== capture.minFilter ||
    view.magFilter !== capture.magFilter ||
    view.anisotropy !== capture.anisotropy ||
    view.generateMipmaps !== capture.generateMipmaps ||
    view.premultiplyAlpha !== capture.premultiplyAlpha ||
    view.flipY !== capture.flipY ||
    view.format !== capture.format ||
    view.type !== capture.type
  view.wrapS = capture.wrapS
  view.wrapT = capture.wrapT
  view.minFilter = capture.minFilter
  view.magFilter = capture.magFilter
  view.anisotropy = capture.anisotropy
  view.generateMipmaps = capture.generateMipmaps
  view.premultiplyAlpha = capture.premultiplyAlpha
  view.flipY = capture.flipY
  view.format = capture.format
  view.type = capture.type
  return changed
}

export function createRawCaptureView(capture: THREE.Texture): RawCaptureView {
  const texture = new THREE.Texture(captureCanvas(capture))
  texture.colorSpace = THREE.NoColorSpace
  texture.onUpdate = () => capture.onUpdate?.(capture)
  let uploadedVersion = -1
  let allocated: { width: number; height: number; mips: boolean } | null = null

  const release = () => {
    texture.dispose()
    allocated = null
    uploadedVersion = -1
  }

  return {
    texture,
    sync() {
      const image = captureCanvas(capture)
      const samplerChanged = copySampler(capture, texture)
      const imageChanged = texture.image !== image
      texture.image = image
      const next = { width: image.width, height: image.height, mips: capture.generateMipmaps }
      // A resized canvas needs new storage; uploading into the old size is rejected.
      if (allocated && (allocated.width !== next.width || allocated.height !== next.height || allocated.mips !== next.mips)) {
        release()
      }
      if (!allocated || imageChanged || samplerChanged || uploadedVersion !== capture.version) {
        allocated = next
        uploadedVersion = capture.version
        texture.needsUpdate = true
      }
    },
    dispose: release,
  }
}
