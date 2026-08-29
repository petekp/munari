// The crystal's material, and the only place its pose is decided.
//
// The law: the pose the shader DREW with is the pose the pointer is
// corrected against. One object, written once per frame, read by both. A
// second copy stepped on the page's own clock would run on a different
// cadence from the renderer, so the click would be corrected for a crystal
// that was never on screen — and it would look right the whole time,
// because the picture comes from the copy that is correct.
//
// That is why `frame` is filled in here rather than returned: the raycast in
// `Crystal.tsx` reads it between frames, and what it must find is the last
// thing drawn.
//
// The physics steps on the RENDERER's delta and not on a pointermove, so a
// hand that stops still lets the spring finish settling. Driven off moves
// alone the crystal would freeze mid-tilt the instant the hand stopped,
// which is the one moment the lag is most visible.
//
// THE EYE IS READ FROM THE CAMERA, not computed from the fov. Every ray in
// this scene starts there — the two marches, the bend the pointer is
// corrected by, and the parallax that decides where a tip floating 75px off
// the page lands on it. A second derivation of the camera would be a second
// thing to keep in step with `PixelPerfect`, and its error would show up as
// a click that misses by more the further from the middle of the screen you
// go.
//
// Ownership: the uniform bag, the frame write and the eye. Shape, optics and
// physics are `crystalLaw.ts`; pixels are `crystalShaders.ts`.

import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSurfaceUniforms } from '@petepetrash/munari'
import { CRYSTAL_FRAG, CRYSTAL_VERT } from './crystalShaders'
import {
  frameOf,
  lightDirOf,
  makePose,
  stepCrystal,
  type CrystalFrame,
  type Vec3,
} from './crystalLaw'
import type { CrystalTuning } from './crystalTuning'

/** Where the hand is, in sheet px with y down. Written by the page. */
export interface CrystalDrive {
  x: number
  y: number
}

export function CrystalMaterial({
  drive,
  frame,
  eye,
  tune,
  stageW,
  stageH,
}: {
  drive: React.RefObject<CrystalDrive>
  /** Filled every frame with the pose just drawn, for the pointer to read. */
  frame: React.RefObject<CrystalFrame>
  /** Filled every frame with the camera in sheet px, likewise. */
  eye: React.RefObject<[number, number, number]>
  tune: CrystalTuning
  stageW: number
  stageH: number
}) {
  const surface = useSurfaceUniforms()
  const camera = useThree((s) => s.camera)
  const material = useRef<THREE.ShaderMaterial>(null)
  const pose = useRef(makePose(drive.current.x, drive.current.y))

  // The panel mutates the bag in place, so the frame loop re-reads whatever
  // the caller holds rather than this render's capture.
  const cfg = useRef(tune)
  cfg.current = tune

  // Mutated rather than replaced: a window drag writes this every frame.
  const box = useRef({ w: stageW, h: stageH })
  box.current.w = stageW
  box.current.h = stageH

  // Initial values only. r3f copies this bag entry by entry into slots the
  // material owns and re-runs only on identity change, so per-frame writes
  // go through `material.current.uniforms` below and not through here.
  const uniforms = useMemo(
    () => ({
      ...surface,
      uSheet: { value: new THREE.Vector2(stageW, stageH) },
      uEye: { value: new THREE.Vector3() },
      uTip: { value: new THREE.Vector3() },
      uRot: { value: new THREE.Matrix3() },
      uLightDir: { value: new THREE.Vector3(0, 0, -1) },
      uScalePx: { value: tune.scalePx },
      uRoundPx: { value: tune.roundPx },
      uChamferPx: { value: tune.chamferPx },
      uGirdlePx: { value: tune.girdlePx },
      uGirdleThickPx: { value: tune.girdleThickPx },
      uCrownDeg: { value: tune.crownDeg },
      uCrownPx: { value: tune.crownPx },
      uPavilionDeg: { value: tune.pavilionDeg },
      uPavilionPx: { value: tune.pavilionPx },
      uIor: { value: tune.ior },
      uMaxBendPx: { value: tune.maxBendPx },
      uDispersion: { value: tune.dispersion },
      uEdgeLight: { value: tune.edgeLight },
      uSkyHigh: { value: tune.skyHigh },
      uSkyLow: { value: tune.skyLow },
      uSpecular: { value: tune.specular },
      uSpecularPow: { value: tune.specularPow },
      uAbsorbPer100: { value: tune.absorbPer100 },
      uShadow: { value: tune.shadow },
      uShadowSoftPx: { value: tune.shadowSoftPx },
      uCaustic: { value: tune.caustic },
      uCausticWidthPx: { value: tune.causticWidthPx },
    }),
    // Read once for starting values; the frame loop owns them from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface],
  )

  useFrame((_, delta) => {
    const u = material.current?.uniforms
    if (!u) return
    const t = cfg.current
    const w = box.current.w
    const h = box.current.h

    // World is centred on the sheet with y up; the law and the pointer both
    // speak sheet px with y down and the origin at the top left corner.
    const e: Vec3 = [
      w / 2 + camera.position.x,
      h / 2 - camera.position.y,
      camera.position.z,
    ]
    eye.current[0] = e[0]
    eye.current[1] = e[1]
    eye.current[2] = e[2]

    stepCrystal(pose.current, drive.current.x, drive.current.y, delta, t)
    const f = frameOf(pose.current, t, e)
    // Copied field by field rather than swapped: the raycast holds this
    // object, and handing it a new one would leave the pointer reading a
    // pose from whenever it last looked.
    frame.current.tipX = f.tipX
    frame.current.tipY = f.tipY
    frame.current.tipZ = f.tipZ
    for (let i = 0; i < 9; i++) frame.current.rot[i] = f.rot[i]

    u.uEye.value.set(e[0], e[1], e[2])
    u.uTip.value.set(f.tipX, f.tipY, f.tipZ)
    // `fromArray` is column-major, which is the order `rockThenSpin` builds
    // in and the order THREE.Matrix3 stores — so this is a copy, not a
    // transpose, and `uRot * v` in GLSL rotates local into the sheet.
    u.uRot.value.fromArray(f.rot)

    const l = lightDirOf(t)
    u.uLightDir.value.set(l[0], l[1], l[2])

    // A resize moves this and nothing else: every tuned length is CSS px,
    // and this is the only uniform that says how big the sheet is.
    u.uSheet.value.set(w, h)

    // Every tuned uniform, every frame. The panel writes into the bag and
    // tells nobody, so re-reading is the whole subscription.
    u.uScalePx.value = t.scalePx
    u.uRoundPx.value = t.roundPx
    u.uChamferPx.value = t.chamferPx
    u.uGirdlePx.value = t.girdlePx
    u.uGirdleThickPx.value = t.girdleThickPx
    u.uCrownDeg.value = t.crownDeg
    u.uCrownPx.value = t.crownPx
    u.uPavilionDeg.value = t.pavilionDeg
    u.uPavilionPx.value = t.pavilionPx
    u.uIor.value = t.ior
    u.uMaxBendPx.value = t.maxBendPx
    u.uDispersion.value = t.dispersion
    u.uEdgeLight.value = t.edgeLight
    u.uSkyHigh.value = t.skyHigh
    u.uSkyLow.value = t.skyLow
    u.uSpecular.value = t.specular
    u.uSpecularPow.value = t.specularPow
    u.uAbsorbPer100.value = t.absorbPer100
    u.uShadow.value = t.shadow
    u.uShadowSoftPx.value = t.shadowSoftPx
    u.uCaustic.value = t.caustic
    u.uCausticWidthPx.value = t.causticWidthPx

    // `useSurfaceUniforms` refreshes its own `tMap` slot every render, but
    // the material holds a copy of that slot — so a source replaced mid-life
    // would leave the sheet drawing the disposed texture.
    u.tMap.value = surface.tMap.value
  })

  return (
    <shaderMaterial
      ref={material}
      uniforms={uniforms}
      vertexShader={CRYSTAL_VERT}
      fragmentShader={CRYSTAL_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}
