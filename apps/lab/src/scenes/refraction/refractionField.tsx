// The lens field — the leaving page's ink mass, box-filtered to an eighth
// of its own scale and kept in a render target — and the spread grown out
// of it, which is what the aperture front travels along.
//
// The law: the bend samples the FIELD and never the page texture. The page
// is text, and text is a high-frequency signal; a lens cut from it displaces
// every arriving glyph in a different direction and tears the arriving page
// apart instead of bending it.
//
// The fault this exists to avoid, measured 2026-08-22 at full size: with
// the bend driven off the page's own luminance, both documents were legible
// on top of each other across the whole panel. Amplitudes 26, 12 and 6 were
// equally bad and only 0 was clean, which is the tell that the magnitude
// was never the problem. Spreading the finite difference out to 16px did
// not fix it either — five taps at that spacing over 13px lines is point
// sampling a periodic signal, and the result was colour noise.
//
// The SPREAD is a second, coarser field, and it is really two: the same ink
// pushed outward a pass at a time until it covers the margins, and the paper
// pushed inward the same way. It exists because the aperture needs an order
// for the parts of a page the ink does not vary over — the empty margins,
// which the circle it used to get that order from ordered visibly as a
// circle, and the insides of solid marks, which nothing ordered at all until
// the second chain. The material takes the difference of the two.
//
// Ownership: this module owns both targets and the passes that fill them.
// The material owns the bend and the front; the tuning owns how coarse the
// field is and how far the spread reaches.

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { spreadDecay, spreadPasses } from './refractionLaw'
import { FIELD_FRAG, FIELD_VERT, SPREAD_FRAG } from './refractionShaders'
import { refractionTuning as tune, STAGE_H, STAGE_W } from './refractionTuning'

/** A field's own size in texels, for a given CSS px per texel. */
const sizeInTexels = (px: number) => ({
  w: Math.max(4, Math.round(STAGE_W / px)),
  h: Math.max(4, Math.round(STAGE_H / px)),
})

export interface InkField {
  /** The lens the bend samples. */
  target: THREE.WebGLRenderTarget
  /** 1 / field size, so the material can step exactly one texel. */
  texel: THREE.Vector2
  /**
   * The ink grown outward, in 0..1, whichever of the ping-pong pair was
   * written last. A uniform slot rather than a texture, because the material
   * re-reads it every frame and the answer alternates.
   */
  spread: { value: THREE.Texture }
  /** The paper grown inward, the same way. The material takes the difference. */
  hollow: { value: THREE.Texture }
}

function fullscreen(material: THREE.ShaderMaterial) {
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
  return scene
}

const smallTarget = (w: number, h: number) =>
  new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  })

/**
 * Keep both fields up to date, one filter pass and N spread passes a frame.
 *
 * Sized in CSS px rather than off the source's own resolution, so the lens
 * is the same shape whatever `resolution` the Surface happens to be
 * rasterising at.
 */
export function useInkField(source: { value: THREE.Texture | null }): InkField {
  const gl = useThree((state) => state.gl)

  const rig = useMemo(() => {
    const { w, h } = sizeInTexels(tune.fieldPx)
    const target = smallTarget(w, h)
    const material = new THREE.ShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: {
        tSource: { value: null },
        uStep: { value: new THREE.Vector2(1 / (w * 8), 1 / (h * 8)) },
      },
      depthTest: false,
      depthWrite: false,
    })

    const s = sizeInTexels(tune.spreadPx)
    const spreadMaterial = new THREE.ShaderMaterial({
      vertexShader: FIELD_VERT,
      fragmentShader: SPREAD_FRAG,
      uniforms: {
        tSource: { value: null },
        uStep: { value: new THREE.Vector2(0.5 / s.w, 0.5 / s.h) },
        uFloor: { value: 0 },
        uScale: { value: 1 },
        uDecay: { value: 0 },
        uInvert: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })

    return {
      target,
      material,
      scene: fullscreen(material),
      camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      texel: new THREE.Vector2(1 / w, 1 / h),
      spreadPair: [smallTarget(s.w, s.h), smallTarget(s.w, s.h)] as const,
      hollowPair: [smallTarget(s.w, s.h), smallTarget(s.w, s.h)] as const,
      spreadMaterial,
      spreadScene: fullscreen(spreadMaterial),
      spread: { value: target.texture },
      hollow: { value: target.texture },
    }
  }, [])

  useEffect(
    () => () => {
      rig.target.dispose()
      rig.material.dispose()
      rig.spreadPair.forEach((t) => t.dispose())
      rig.hollowPair.forEach((t) => t.dispose())
      rig.spreadMaterial.dispose()
      for (const scene of [rig.scene, rig.spreadScene]) {
        scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose()
        })
      }
    },
    [rig],
  )

  // Restores whatever target was bound rather than assuming null: this runs
  // inside the frame loop, and a scene that rendered to a target of its own
  // would otherwise find it unbound underneath it.
  useFrame(() => {
    const texture = source.value
    if (!texture?.image) return

    // Resized in place rather than through a dependency: the panel writes
    // the bag and nothing tells this hook, so the check IS the subscription.
    const { w, h } = sizeInTexels(tune.fieldPx)
    if (rig.target.width !== w || rig.target.height !== h) {
      rig.target.setSize(w, h)
      rig.texel.set(1 / w, 1 / h)
      rig.material.uniforms.uStep.value.set(1 / (w * 8), 1 / (h * 8))
    }
    const s = sizeInTexels(tune.spreadPx)
    if (rig.spreadPair[0].width !== s.w || rig.spreadPair[0].height !== s.h) {
      rig.spreadPair.forEach((t) => t.setSize(s.w, s.h))
      rig.hollowPair.forEach((t) => t.setSize(s.w, s.h))
      rig.spreadMaterial.uniforms.uStep.value.set(0.5 / s.w, 0.5 / s.h)
    }
    const passes = spreadPasses(tune.spreadReachPx, tune.spreadPx)
    const su = rig.spreadMaterial.uniforms
    su.uDecay.value = spreadDecay(passes)

    const previous = gl.getRenderTarget()

    rig.material.uniforms.tSource.value = texture
    gl.setRenderTarget(rig.target)
    gl.render(rig.scene, rig.camera)

    // Ping-pong, run twice: once growing the ink outward and once growing the
    // paper inward. Pass zero reads raw ink heights and normalises them, and
    // is the only pass that inverts; every pass after it reads a field
    // already in 0..1, so its own normalisation has to be the identity.
    const scale = 1 / Math.max(1e-4, tune.apertureCeil - tune.apertureFloor)
    const chain = (pair: readonly THREE.WebGLRenderTarget[], invert: number) => {
      let read: THREE.Texture = rig.target.texture
      for (let i = 0; i < passes; i++) {
        su.uFloor.value = i === 0 ? tune.apertureFloor : 0
        su.uScale.value = i === 0 ? scale : 1
        su.uInvert.value = i === 0 ? invert : 0
        su.tSource.value = read
        const write = pair[i % 2]
        gl.setRenderTarget(write)
        gl.render(rig.spreadScene, rig.camera)
        read = write.texture
      }
      return read
    }
    rig.spread.value = chain(rig.spreadPair, 0)
    rig.hollow.value = chain(rig.hollowPair, 1)

    gl.setRenderTarget(previous)
  })

  return rig
}
