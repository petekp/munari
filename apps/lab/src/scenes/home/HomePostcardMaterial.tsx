// Postcard stock — live print on the front, unprinted paper on the reverse.
// The postcard's CSS layer stays above the heading in both presentations;
// lighting heights must not punch heading-shaped holes into the sheet (#50).

import { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { frontFacing, output, vec4 } from 'three/tsl'
import { useSurfaceNodes } from '@petepetrash/munari'

export function HomePostcardMaterial() {
  const surface = useSurfaceNodes()
  const material = useMemo(() => {
    // One pass preserves frontFacing. Three's transparent two-pass path flips
    // winding for its back pass, which would print the front on the reverse (#51).
    const created = new MeshBasicNodeMaterial({
      transparent: true,
      premultipliedAlpha: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    })
    created.colorNode = surface.map
    // The front keeps Three's output, which multiplies the sample by alpha
    // before the canvas conversion, as MeshBasicMaterial did on WebGL.
    created.outputNode = frontFacing.select(output, vec4(0.84, 0.81, 0.74, 1))
    return created
  }, [surface])
  useLayoutEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}
