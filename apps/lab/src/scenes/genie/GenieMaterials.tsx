// Genie's materials — the sheet's shaded material and the film composite,
// as components a mesh wears.
//
// The node graphs and their blend rules live in genieNodes.ts. These
// components own the uniforms each frame sets, and dispose what they build.
//
// Ownership: Genie.tsx mounts them on a flight's meshes and on the prewarm
// meshes that build their pipelines at load.

import { useLayoutEffect, useMemo, useState } from 'react'
import type * as THREE from 'three'
import type { MeshBasicNodeMaterial } from 'three/webgpu'
import { type SourceUvRect, useSurfaceNodes } from '@petepetrash/munari'
import { useFrameTexture } from '@petepetrash/munari/advanced'
import {
  createGenieFilmMaterial,
  createGenieFilmPlacement,
  createGenieMaterial,
  createGenieShade,
} from './genieNodes'

/** How hard the funnel has to be squeezing a row before its shadow goes.
 *
 *  Measured, and the measurement overturned the first answer. Reasoning
 *  from the drop's width said a 5px band stops reading as a shadow at
 *  about two rendered pixels, so the band was set to leave between row
 *  scales 0.45 and 0.20 — and shadow-travels then read the identical
 *  profile with the fade on and with it disabled. The reason is that a
 *  minified band does not stay crisp and merely narrow: the GPU averages
 *  it against the transparent margin outside it, so it loses ALPHA at
 *  the same time it loses width. Ink measured down the held funnel, one
 *  frame (2026-08-09, `--drop: 5px`):
 *
 *      row scale   1.00   0.80   0.77   0.69   0.63   0.52   ≤0.35
 *      shade ink    190     89     63     41     27     15       0
 *
 *  Half the shadow is gone by 0.80 and four fifths by 0.69, with none of
 *  that asked for — which is exactly the complaint, a shadow that
 *  dissolves into a grey haze down one flank instead of leaving. A fade
 *  under 0.45 had nothing left to fade. So the band is placed where the
 *  ink still exists: whole above 0.95, gone by 0.55, which LEADS the
 *  dissolution rather than trailing it and takes the smear with it. The
 *  ceiling stays clear of 1.0 for the reason it always did — a sheet at
 *  rest, and the whole first stretch of a flight, must be untouched. */
const SHADE_FADE: [number, number] = [0.55, 0.95]

export function GenieMaterial({ shade }: { shade: [number, number] }) {
  const surface = useSurfaceNodes()
  const [values] = useState(() => createGenieShade(SHADE_FADE))
  values.edge.value.set(shade[0], shade[1])
  // Surface creates every DOM texture premultiplied (decisions.md #5).
  // This material only owns the matching blend rule (genieNodes.ts).
  const material = useMemo(() => createGenieMaterial(surface, values), [surface, values])
  useLayoutEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

interface FilmCompositeMaterialProps {
  chromeTexture: THREE.Texture
  filmRadius: number
  /** The film's box in the outer capture, once the anchor set is whole. */
  uv: SourceUvRect | null
  shade: [number, number]
  width: number
  height: number
  ref: React.RefObject<MeshBasicNodeMaterial | null>
}

export function FilmCompositeMaterial({
  chromeTexture,
  filmRadius,
  uv,
  shade,
  width,
  height,
  ref,
}: FilmCompositeMaterialProps) {
  const filmTexture = useFrameTexture()
  const [values] = useState(() => ({ shade: createGenieShade(SHADE_FADE), placement: createGenieFilmPlacement() }))
  values.placement.size.value.set(width, height)
  values.shade.edge.value.set(shade[0], shade[1])
  if (uv) {
    values.placement.rect.value.set(uv.uMin, 1 - uv.vMax, uv.uMax - uv.uMin, uv.vMax - uv.vMin)
  }
  values.placement.radius.value = filmRadius
  // The first child render has no FrameSurface texture, and a node material
  // cannot be built around a missing sampler. FrameSurface suppresses the
  // mesh until the texture exists; the material is built then.
  const material = useMemo(
    () => (filmTexture ? createGenieFilmMaterial(chromeTexture, filmTexture, values.placement, values.shade) : null),
    [chromeTexture, filmTexture, values],
  )
  useLayoutEffect(() => {
    ref.current = material
    return () => {
      ref.current = null
      material?.dispose()
    }
  }, [ref, material])
  if (!material) return null
  return <primitive object={material} attach="material" />
}
