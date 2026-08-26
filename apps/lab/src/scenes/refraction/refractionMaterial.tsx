// The sheet's material — one shader material holding two live documents,
// the arriving one sampled through a drop of glass grown out of the
// leaving one.
//
// The law: the drop is a function of CSS px, never of texels. Every
// distance a caller tunes — the meniscus, the height, the bend — is stated
// in CSS px and `uTexel` converts, so changing a stage's size or the
// device's pixel ratio does not silently change the shape of the glass.
//
// It lives apart from `Refraction.tsx` because two scenes now mount it: the
// refraction crossing over a page, and the gallery crossing over
// photographs. What differs between them is the tuning bag and the stage
// box, and both are parameters here. What must NOT differ is the per-frame
// uniform write below — a second copy of it drifts silently, because a
// uniform nobody writes just keeps its initial value and the scene looks
// merely mistuned rather than broken.
//
// Two boxes, not one, and the difference only shows on a stage that
// resizes. `stage` is the sheet's real size and is what turns a tuned CSS
// px into uv. `fieldStage` is the box the ink and spread grids are counted
// against, and it is deliberately allowed to stay fixed while the sheet
// grows: those grids live in uv, so only their texel COUNT reaches the
// picture, and a count that followed the viewport would make the same
// photograph open in a different order in a different window.
//
// Ownership: this module owns the uniform bag and the frame write. Shape
// belongs to `refractionLaw.ts`, pixels to `refractionShaders.ts`, numbers
// to whichever tuning bag the caller passes.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  useSurfaceTextureOf,
  useSurfaceUniforms,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { useInkField } from './refractionField'
import { refractionStage, type RefractionShape } from './refractionLaw'
import { REFRACTION_FRAG, REFRACTION_VERT } from './refractionShaders'

/**
 * Every number the sheet reads, as a shape rather than a specific bag.
 *
 * Both scene tuning bags satisfy it structurally, so neither has to import
 * the other's — and a bag that drops a knob fails to typecheck at the mount
 * instead of drawing with a stale uniform.
 */
export interface DropTuning extends RefractionShape {
  rimPx: number
  heightPx: number
  ior: number
  refractPx: number
  bendTaperPx: number
  dispersion: number
  fieldPx: number
  spreadPx: number
  spreadReachPx: number
  apertureFloor: number
  apertureCeil: number
  apertureInk: number
  apertureDetail: number
  apertureGamma: number
  apertureOvershoot: number
  apertureEdgePx: number
  frontRounding: number
  reflect: number
  roomBand: number
  roomWidth: number
  rim: number
  rimPow: number
  mirrorFalloff: number
}

export interface RefractionDrive {
  /** Scrub position, 0 at the leaving page and 1 at the arriving one. */
  t: number
}

export function RefractionMaterial({
  incoming,
  drive,
  tune,
  stageW,
  stageH,
  fieldW = stageW,
  fieldH = stageH,
  probe,
}: {
  incoming: SurfaceHandle
  drive: React.RefObject<RefractionDrive>
  tune: DropTuning
  /** The sheet's size in CSS px. May change every frame on a resize. */
  stageW: number
  stageH: number
  /** The box the field grids are counted against; defaults to the stage. */
  fieldW?: number
  fieldH?: number
  /**
   * Filled, while this material is mounted, with the aperture the shader
   * samples — for a scene that has to route the pointer between the two
   * documents rather than only draw them.
   *
   * A second field mounted alongside this one would be a second answer, and
   * the two would agree until someone touched one of them. Handing this one
   * out keeps the picture and the pointer reading the same texels.
   */
  probe?: React.RefObject<((u: number, v: number) => number) | null>
}) {
  const surface = useSurfaceUniforms()
  const arriving = useSurfaceTextureOf(incoming)
  const material = useRef<THREE.ShaderMaterial>(null)

  // The frame loop reads these; it cannot read a render closure.
  const arrivingRef = useRef(arriving)
  arrivingRef.current = arriving
  const outgoingSlot = surface.tMap

  // The panel mutates the bag in place, so the frame loop has to re-read
  // whatever the caller is holding rather than the render's capture.
  const cfg = useRef(tune)
  cfg.current = tune

  // Mutated rather than replaced: a resize writes this every frame, and the
  // frame loop reads it. A new object per render would allocate on every
  // pixel of a window drag.
  const box = useRef({ w: stageW, h: stageH })
  box.current.w = stageW
  box.current.h = stageH

  // Registered before the frame write below, so the field the bend samples
  // is this frame's and not the one before it.
  const field = useInkField(
    outgoingSlot,
    useMemo(() => ({ ...tune, stageW: fieldW, stageH: fieldH }), [tune, fieldW, fieldH]),
  )

  // Initial values only. r3f 9.7 copies the `uniforms` prop entry by entry
  // into slots the material owns and re-runs only when the prop's identity
  // changes, so a per-frame write to this bag lands in an object nothing
  // samples (candidates/README.md gap 1). The frame writes below go through
  // the material's own slots, which is the channel that reaches the GPU.
  const uniforms = useMemo(
    () => ({
      ...surface,
      // Sampling the leaving page as its own stand-in keeps a valid texture
      // bound before the resident source publishes. `uHasIncoming` is 0 on
      // exactly those frames, so nothing of it survives the mix.
      tIncoming: { value: surface.tMap.value },
      uHasIncoming: { value: 0 },
      // One CSS PIXEL, not one texel of anything. Every px constant in the
      // tuning — the drop's height, its meniscus, its bend — is stated in CSS
      // px, and a unit that followed the texture's resolution would change
      // what all of them meant every time `resolution` moved.
      uTexel: { value: new THREE.Vector2(1 / stageW, 1 / stageH) },  // rewritten per frame
      uRelief: { value: 0 },
      uTransmission: { value: 0 },
      uZoom: { value: tune.approachZoom },
      tField: { value: field.target.texture },
      uSpreadTexel: { value: field.spreadTexel },
      uRounding: { value: tune.frontRounding },
      tSpread: { value: field.spread.value },
      tHollow: { value: field.hollow.value },
      uDispersion: { value: tune.dispersion },
      uApertureFloor: { value: tune.apertureFloor },
      uApertureCeil: { value: tune.apertureCeil },
      uApertureInk: { value: tune.apertureInk },
      uApertureGamma: { value: tune.apertureGamma },
      uApertureOvershoot: { value: tune.apertureOvershoot },
      uApertureEdge: { value: tune.apertureEdgePx },
      uBendTaper: { value: tune.bendTaperPx },
      uRimPx: { value: tune.rimPx },
      uHeightPx: { value: tune.heightPx },
      uIor: { value: tune.ior },
      uRefractPx: { value: tune.refractPx },
      uReflect: { value: tune.reflect },
      uRoomBand: { value: tune.roomBand },
      uRoomWidth: { value: tune.roomWidth },
      uRim: { value: tune.rim },
      uRimPow: { value: tune.rimPow },
      uFresPow: { value: tune.mirrorFalloff },
    }),
    // Reads the bag once for its starting values; the frame loop owns it
    // from there. Re-running on a bag mutation is impossible anyway — the
    // panel writes in place and the identity never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, field],
  )

  // Indirect rather than assigning `field.apertureAt` itself: the field
  // reassigns that slot every render, and a captured copy would go stale.
  useEffect(() => {
    if (!probe) return
    const ref = probe
    ref.current = (u, v) => field.apertureAt(u, v)
    return () => {
      ref.current = null
    }
  }, [probe, field])

  useFrame(() => {
    const u = material.current?.uniforms
    if (!u) return
    const t = cfg.current
    const stage = refractionStage(drive.current.t, t)
    u.uRelief.value = stage.relief
    u.uTransmission.value = stage.transmission
    u.uZoom.value = stage.zoom
    // A resize moves this and nothing else: every tuned length is CSS px,
    // and this is the only uniform that says how big a CSS px is.
    u.uTexel.value.set(1 / box.current.w, 1 / box.current.h)

    // Every tuned uniform, every frame. The panel writes into the bag and
    // nothing tells the material about it, so re-reading is the whole
    // subscription — and it costs a handful of assignments.
    u.uRimPx.value = t.rimPx
    u.uHeightPx.value = t.heightPx
    u.uIor.value = t.ior
    u.uRefractPx.value = t.refractPx
    u.uBendTaper.value = t.bendTaperPx
    u.uDispersion.value = t.dispersion
    // Each chain alternates between two targets, so the answer is different
    // every frame even though nothing about the material changed.
    u.tSpread.value = field.spread.value
    u.tHollow.value = field.hollow.value
    u.uApertureFloor.value = t.apertureFloor
    u.uApertureCeil.value = t.apertureCeil
    u.uApertureInk.value = t.apertureInk
    u.uApertureGamma.value = t.apertureGamma
    u.uApertureOvershoot.value = t.apertureOvershoot
    u.uApertureEdge.value = t.apertureEdgePx
    u.uRounding.value = t.frontRounding
    u.uReflect.value = t.reflect
    u.uRoomBand.value = t.roomBand
    u.uRoomWidth.value = t.roomWidth
    u.uRim.value = t.rim
    u.uRimPow.value = t.rimPow
    u.uFresPow.value = t.mirrorFalloff
    const texture = arrivingRef.current
    u.tIncoming.value = texture ?? outgoingSlot.value
    u.uHasIncoming.value = texture ? 1 : 0
    // `useSurfaceUniforms` refreshes its own `tMap` slot every render, but
    // the material holds a copy of that slot — so a source replaced mid-life
    // would leave the sheet drawing the disposed texture.
    u.tMap.value = outgoingSlot.value
  })

  return (
    <shaderMaterial
      ref={material}
      uniforms={uniforms}
      vertexShader={REFRACTION_VERT}
      fragmentShader={REFRACTION_FRAG}
      transparent
      premultipliedAlpha
      depthWrite={false}
      toneMapped={false}
    />
  )
}
