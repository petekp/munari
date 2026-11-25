// Flight card shadow — the drop-shadow plane under a crossing card.
//
// renderOrder 2 — AFTER the card, on purpose. The card writes depth (the card
// occludes its own shadow), so drawing the shadow second lets the depth test
// carve the card's silhouette out of it per fragment: CSS's
// outside-the-border-box clip, enforced by geometry. Drawn first, the shadow's
// interior survived under the card and leaked through the border's AA column
// as a 1px dark seam — the "extra border" on the right edge. The corners still
// show fringe: the radius mask DISCARDS there, no depth is written, and the
// shadow paints the notch exactly where CSS would.
//
// The plane lies in front of the cards beneath it while a card crosses, and a
// visible mesh in front of a Surface takes its pointer (decisions.md #78), so
// it opts out of raycasting.
//
// Ownership: Flight owns the material and writes the plane's pose and
// visibility each frame through the ref.

import type { Ref } from 'react'
import type * as THREE from 'three'

const NO_HIT: THREE.Object3D['raycast'] = () => {}

export function FlightCardShadow({ ref, material }: { ref: Ref<THREE.Mesh>; material: THREE.Material }) {
  return (
    <mesh ref={ref} name="flight-card-shadow" raycast={NO_HIT} renderOrder={2} frustumCulled={false} visible={false}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
