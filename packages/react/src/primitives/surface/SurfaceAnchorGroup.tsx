// Surface anchor group — the scene group that stands an anchor's children on its box.
//
// Position comes from the geometry, not from the plane the geometry
// usually is: the same UV on a deformed sheet is somewhere plane math
// cannot name, and an object placed by plane math floats off a sheet the
// moment it bends.
//
// Ownership: this group owns the transform it puts on itself and the box its
// children read. SurfaceAnchor.tsx owns the anchor key's subscription.

import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sampleUvPosition, type SourceUvRect } from '@munari/core'
import { SurfaceAnchorBoxContext, type SurfaceAnchorBox } from './SurfaceAnchor'

const UP = new THREE.Vector3(0, 0, 1)
const NORMAL = new THREE.Vector3()

type GeometryAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute

function attributeVersion(attribute: GeometryAttribute): number {
  return attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute.version
}

export interface SurfaceAnchorGroupProps {
  u: number
  v: number
  offset: number
  rect: SourceUvRect
  children?: React.ReactNode
}

/**
 * The transform, resolved against the presenter's actual geometry.
 *
 * Split out so the sampling runs in a mounted group with a parent to read —
 * the geometry lives on the mesh above, and there is no other way to reach
 * it that does not make every caller pass a ref down.
 */
export function SurfaceAnchorGroup({ u, v, offset, rect, children }: SurfaceAnchorGroupProps) {
  const [group, setGroup] = useState<THREE.Group | null>(null)
  // UVs and triangle indices can move an anchor without changing positions.
  // Replaced attributes can also restart at the same upload version.
  const placedRef = useRef<{
    position: GeometryAttribute
    positionVersion: number
    uvs: GeometryAttribute
    uvVersion: number
    index: THREE.BufferAttribute | null
    indexVersion: number
    u: number
    v: number
    offset: number
  } | null>(null)
  useFrame(() => {
    if (!group) return
    const mesh = group.parent
    if (!(mesh instanceof THREE.Mesh)) return
    const position = mesh.geometry.getAttribute('position')
    const uvs = mesh.geometry.getAttribute('uv')
    if (!position || !uvs) return
    const index = mesh.geometry.getIndex()
    const positionVersion = attributeVersion(position)
    const uvVersion = attributeVersion(uvs)
    const indexVersion = index?.version ?? 0
    const last = placedRef.current
    if (
      last &&
      last.position === position &&
      last.positionVersion === positionVersion &&
      last.uvs === uvs &&
      last.uvVersion === uvVersion &&
      last.index === index &&
      last.indexVersion === indexVersion &&
      last.u === u &&
      last.v === v &&
      last.offset === offset
    ) {
      return
    }
    const sample = sampleUvPosition(
      position.array,
      uvs.array,
      index?.array ?? null,
      u,
      v,
    )
    if (!sample) return
    placedRef.current = { position, positionVersion, uvs, uvVersion, index, indexVersion, u, v, offset }
    group.position.set(
      sample.x + sample.nx * offset,
      sample.y + sample.ny * offset,
      sample.z + sample.nz * offset,
    )
    NORMAL.set(sample.nx, sample.ny, sample.nz)
    group.quaternion.setFromUnitVectors(UP, NORMAL)
  })

  const box = useMemo<SurfaceAnchorBox>(
    () => ({ cssWidth: rect.cssWidth, cssHeight: rect.cssHeight, uv: rect }),
    [rect],
  )

  return (
    <group ref={setGroup}>
      <SurfaceAnchorBoxContext value={box}>{children}</SurfaceAnchorBoxContext>
    </group>
  )
}
