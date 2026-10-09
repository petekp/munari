// The sheet's material — one node material holding two live documents,
// the arriving one sampled through a drop of glass grown out of the
// leaving one.
//
// The law: the drop is a function of CSS px, never of texels. Every
// distance a caller tunes — the meniscus, the height, the bend — is stated
// in CSS px and `texel` converts, so changing a stage's size or the
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
// belongs to `refractionLaw.ts`, pixels to `refractionNodes.ts`, numbers
// to whichever tuning bag the caller passes.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  useSurfaceNodes,
  useSurfaceTextureOf,
  type SurfaceHandle,
} from '@petepetrash/munari'
import { useInkField } from './refractionField'
import { refractionStage, type RefractionShape } from './refractionLaw'
import { createRefractionMaterial, createRefractionValues } from './refractionNodes'

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
  incomingPart,
  drive,
  tune,
  stageW,
  stageH,
  fieldW = stageW,
  fieldH = stageH,
  probe,
}: {
  incoming: SurfaceHandle
  incomingPart?: string
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
  const surface = useSurfaceNodes()
  const arriving = useSurfaceTextureOf(incoming, incomingPart)

  // The frame loop reads these; it cannot read a render closure.
  const arrivingRef = useRef(arriving)
  arrivingRef.current = arriving

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
    surface.map,
    tune,
    fieldW,
    fieldH,
  )

  // Built once per field. The nodes keep their identity, so the frame loop
  // below writes `.value` on them and the material never rebuilds.
  const values = useMemo(
    () =>
      createRefractionValues(
        {
          // Sampling the leaving page as its own stand-in keeps a valid texture
          // bound before the resident source publishes. `hasIncoming` is 0 on
          // exactly those frames, so nothing of it survives the mix.
          incoming: surface.map.value,
          ink: field.target.texture,
          spread: field.spread.value,
          hollow: field.hollow.value,
        },
        // One CSS PIXEL, not one texel of anything. Every px constant in the
        // tuning — the drop's height, its meniscus, its bend — is stated in CSS
        // px, and a unit that followed the texture's resolution would change
        // what all of them meant every time `resolution` moved.
        new THREE.Vector2(1 / stageW, 1 / stageH), // rewritten per frame
        field.spreadTexel,
      ),
    // Initial textures only; the frame loop owns them from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, field],
  )
  const material = useMemo(() => createRefractionMaterial(surface, values), [surface, values])
  useEffect(() => () => material.dispose(), [material])

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
    const v = values
    const t = cfg.current
    const stage = refractionStage(drive.current.t, t)
    v.relief.value = stage.relief
    v.transmission.value = stage.transmission
    v.zoom.value = stage.zoom
    // A resize moves this and nothing else: every tuned length is CSS px,
    // and this is the only uniform that says how big a CSS px is.
    v.texel.value.set(1 / box.current.w, 1 / box.current.h)

    // Every tuned uniform, every frame. The panel writes into the bag and
    // nothing tells the material about it, so re-reading is the whole
    // subscription — and it costs a handful of assignments.
    v.rimPx.value = t.rimPx
    v.heightPx.value = t.heightPx
    v.ior.value = t.ior
    v.refractPx.value = t.refractPx
    v.bendTaper.value = t.bendTaperPx
    v.dispersion.value = t.dispersion
    // Each chain alternates between two targets, so the answer is different
    // every frame even though nothing about the material changed.
    v.spread.value = field.spread.value
    v.hollow.value = field.hollow.value
    v.apertureFloor.value = t.apertureFloor
    v.apertureCeil.value = t.apertureCeil
    v.apertureInk.value = t.apertureInk
    v.apertureGamma.value = t.apertureGamma
    v.apertureOvershoot.value = t.apertureOvershoot
    v.apertureEdge.value = t.apertureEdgePx
    v.rounding.value = t.frontRounding
    v.reflect.value = t.reflect
    v.roomBand.value = t.roomBand
    v.roomWidth.value = t.roomWidth
    v.rim.value = t.rim
    v.rimPow.value = t.rimPow
    v.fresPow.value = t.mirrorFalloff
    const texture = arrivingRef.current
    v.incoming.value = texture ?? surface.map.value
    v.hasIncoming.value = texture ? 1 : 0
  })

  return <primitive object={material} attach="material" />
}
