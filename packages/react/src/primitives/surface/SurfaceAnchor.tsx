// <Surface.Anchor> — matter standing on a named box in the source.
//
// The law: an anchor's children exist only while a COMPLETE anchor set is
// true of the generation drawn on this geometry. Nothing renders from a
// half-collected set and nothing renders from a set that describes pixels
// which are not on the mesh, because either one places hardware where the
// content is about to be rather than where it is.
//
// Position comes from the geometry, not from the plane the geometry
// usually is: the same UV on a deformed sheet is somewhere plane math
// cannot name, and matter placed by plane math floats off a sheet the
// moment it bends.
//
// Ownership: this component owns its key's subscription and the transform
// it puts on its group. It owns no receipt, no paint, and no texture.

import { createContext, use, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sampleUvPosition, type SourceUvRect } from '@munari/core'
import { useSurfaceAnchorContext } from './surfaceAnchorScope'
import { useSurfacePart } from './surfaceContext'

export interface SurfaceAnchorProps {
  /** The `data-munari-anchor` value this stands on. */
  name: string
  /** Lifted off the surface along its normal, in local units. */
  offset?: number
  children?: React.ReactNode
}

/** What an anchored child needs to size itself against its box. */
export interface SurfaceAnchorBox {
  /** The anchor's captured CSS size — physical, and stable under resize. */
  readonly cssWidth: number
  readonly cssHeight: number
  /** The same box in the presenter's local units. */
  readonly width: number
  readonly height: number
  /**
   * Where the box sits in the source's texture. A child that samples the
   * live capture at its own box — an emitter standing over an LED readout —
   * needs the rect, not just the size.
   */
  readonly uv: SourceUvRect
}

const UP = new THREE.Vector3(0, 0, 1)
const NORMAL = new THREE.Vector3()

const SurfaceAnchorBoxContext = createContext<SurfaceAnchorBox | null>(null)

/**
 * The box this anchor stands on. `cssWidth`/`cssHeight` are the captured CSS
 * dimensions — physical, so a control keeps its real size when the panel it
 * is on resizes — and `width`/`height` are the same box in the presenter's
 * local units, which is what geometry below it should be built in.
 */
export function useSurfaceAnchorBox(): SurfaceAnchorBox | null {
  return use(SurfaceAnchorBoxContext)
}

export function SurfaceAnchor({ name, offset = 0, children }: SurfaceAnchorProps) {
  const scope = useSurfaceAnchorContext('Surface.Anchor')
  const part = useSurfacePart('Surface.Anchor')
  useEffect(() => scope.require(name), [scope, name])

  const [box, setBox] = useState(() => scope.box(name))
  useEffect(() => {
    const read = () => setBox(scope.box(name))
    read()
    return scope.subscribe(read)
  }, [scope, name])

  const [sourceWidth, sourceHeight] = part.size
  const placed = useMemo(() => {
    if (!box) return null
    // Mirrored sources sample the texture backwards, so the geometry that
    // shows a box on the left is the geometry on the right.
    const u = scope.mirrorU() ? 1 - (box.uMin + box.uMax) / 2 : (box.uMin + box.uMax) / 2
    const v = (box.vMin + box.vMax) / 2
    return { u, v }
  }, [box, scope])

  if (!box || !placed) return null
  return (
    <AnchorGroup
      u={placed.u}
      v={placed.v}
      offset={offset}
      rect={box}
      sourceWidth={sourceWidth}
      sourceHeight={sourceHeight}
    >
      {children}
    </AnchorGroup>
  )
}

/**
 * The transform, resolved against the presenter's actual geometry.
 *
 * Split out so the sampling runs in a mounted group with a parent to read —
 * the geometry lives on the mesh above, and there is no other way to reach
 * it that does not make every caller pass a ref down.
 */
function AnchorGroup({
  u,
  v,
  offset,
  rect,
  sourceWidth,
  sourceHeight,
  children,
}: {
  u: number
  v: number
  offset: number
  rect: SourceUvRect
  sourceWidth: number
  sourceHeight: number
  children?: React.ReactNode
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null)
  // Re-sampled when the vertices move, not once at mount. A sheet that
  // deforms every frame carries its anchors with it; one that never moves
  // pays a version compare per frame and nothing else.
  // A new geometry begins its position attribute at version 0. Comparing
  // only that version let Knobs keep anchors from a 721px panel on the new
  // 463px breakpoint geometry (2026-08-18). Geometry identity is therefore
  // part of the sampled shape, not an implementation detail.
  const placedRef = useRef<{
    geometry: THREE.BufferGeometry | null
    version: number
    u: number
    v: number
    offset: number
  }>({ geometry: null, version: -1, u: NaN, v: NaN, offset: NaN })
  useFrame(() => {
    if (!group) return
    const mesh = group.parent
    if (!(mesh instanceof THREE.Mesh)) return
    const position = mesh.geometry.getAttribute('position')
    const uvs = mesh.geometry.getAttribute('uv')
    if (!position || !uvs) return
    const last = placedRef.current
    if (
      last.geometry === mesh.geometry &&
      last.version === position.version &&
      last.u === u &&
      last.v === v &&
      last.offset === offset
    ) {
      return
    }
    const sample = sampleUvPosition(
      position.array,
      uvs.array,
      mesh.geometry.getIndex()?.array ?? null,
      u,
      v,
    )
    if (!sample) return
    placedRef.current = { geometry: mesh.geometry, version: position.version, u, v, offset }
    group.position.set(
      sample.x + sample.nx * offset,
      sample.y + sample.ny * offset,
      sample.z + sample.nz * offset,
    )
    NORMAL.set(sample.nx, sample.ny, sample.nz)
    group.quaternion.setFromUnitVectors(UP, NORMAL)
  })

  const box = useMemo<SurfaceAnchorBox>(
    () => ({
      cssWidth: rect.cssWidth,
      cssHeight: rect.cssHeight,
      width: sourceWidth > 0 ? rect.cssWidth / sourceWidth : 0,
      height: sourceHeight > 0 ? rect.cssHeight / sourceHeight : 0,
      uv: rect,
    }),
    [rect, sourceWidth, sourceHeight],
  )

  return (
    <group ref={setGroup}>
      <SurfaceAnchorBoxContext value={box}>{children}</SurfaceAnchorBoxContext>
    </group>
  )
}

/**
 * Every listed anchor at once, or null while any of them is missing.
 *
 * The same transaction `<Surface.Anchor>` reads, for the consumer that
 * cannot be one group per box: a single geometry cut around several boxes,
 * or a page-side scroller that has to know where a control landed. Null is
 * "the set is not complete for the pixels on this mesh", not "no anchors".
 */
export function useSurfaceAnchorRects(
  names: readonly string[],
): Readonly<Record<string, SourceUvRect>> | null {
  const scope = useSurfaceAnchorContext('useSurfaceAnchorRects')
  // Keyed by content, not identity: a caller building the list inline hands
  // a new array every render, and requiring on identity would drop and
  // re-declare every key in the set on each one — which invalidates the
  // committed transaction and blanks the matter standing on it.
  const key = names.join('\u0000')
  const keys = useMemo(() => (key === '' ? [] : key.split('\u0000')), [key])

  useEffect(() => {
    const releases = keys.map((name) => scope.require(name))
    return () => {
      for (const release of releases) release()
    }
  }, [scope, keys])

  const [rects, setRects] = useState<Readonly<Record<string, SourceUvRect>> | null>(null)
  useEffect(() => {
    const read = () => {
      const next: Record<string, SourceUvRect> = {}
      for (const name of keys) {
        const box = scope.box(name)
        if (!box) {
          setRects(null)
          return
        }
        next[name] = box
      }
      setRects((current) => (sameRects(current, next) ? current : next))
    }
    read()
    return scope.subscribe(read)
  }, [scope, keys])
  return rects
}

/** Value equality, so a re-collected but unmoved set costs no render. */
function sameRects(
  a: Readonly<Record<string, SourceUvRect>> | null,
  b: Readonly<Record<string, SourceUvRect>>,
): boolean {
  if (!a) return false
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (!left || !right) return false
    if (
      left.uMin !== right.uMin ||
      left.uMax !== right.uMax ||
      left.vMin !== right.vMin ||
      left.vMax !== right.vMax ||
      left.cssWidth !== right.cssWidth ||
      left.cssHeight !== right.cssHeight
    ) {
      return false
    }
  }
  return true
}
