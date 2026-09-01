// Marble-hand geometry — a reaching anatomical hand as a marble fragment.
//
// The law: geometry origin is the pointing fingertip. Rotation, tilt and
// scale can then change freely without moving the point that owns the click.
//
// The fault this prevents, 2026-08-30: centring a sculpture fragment gives
// it a good model-viewer pivot and a false cursor. Any tilt then swings the
// fingertip through an arc and the visible pointer misses.
//
// Ownership: the CC BY source credit lives with the asset. make-marble-hand
// bakes the fingertip pivot and closed wrist. This module supplies smooth
// anatomical normals while keeping the cut edge sharp, and bakes the idle
// tap's per-vertex finger weights so every program that draws this geometry
// bends the same stone.

import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildMarbleHandTapAttribute } from './marbleHandTapLaw'

const MODEL_URL = '/models/marble-hand/classical-hand.stl'

/** A classical pointing hand whose local origin is the index fingertip. */
export function useMarbleHandGeometry(): THREE.BufferGeometry {
  const source = useLoader(STLLoader, MODEL_URL)
  const geometry = useMemo(() => {
    // Sixty degrees smooths the scanned knuckles but preserves the sawn
    // wrist's 90-degree edge. Smoothing the whole closed mesh softened that
    // edge into a melted rim during the 2026-08-30 browser pass.
    const next = toCreasedNormals(source.clone(), Math.PI / 3)
    // After creasing: that pass rebuilds the vertex list, and the weights
    // are indexed by vertex.
    buildMarbleHandTapAttribute(next)
    next.computeBoundingBox()
    next.computeBoundingSphere()
    return next
  }, [source])

  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

useLoader.preload(STLLoader, MODEL_URL)
