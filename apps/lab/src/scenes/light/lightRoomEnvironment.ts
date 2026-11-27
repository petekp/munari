// Room environment — the lamp's reflection environment, baked from three's
// RoomEnvironment.
//
// The law: the room's PMREM pipelines are built off the frame first, so the
// bake itself blocks nothing (decisions.md #80).
//
// Ownership: LightLamp assigns the texture and disposes it.

import type * as THREE from 'three'
import { PMREMGenerator, type WebGPURenderer } from 'three/webgpu'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { prebuildPipelines } from '@petepetrash/munari/advanced'

export async function bakeRoom(renderer: WebGPURenderer): Promise<THREE.Texture> {
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const rehearsals: THREE.RenderTarget[] = []
  try {
    await prebuildPipelines(renderer, () => {
      rehearsals.push(pmrem.fromScene(room, 0.04))
    })
    for (const rehearsal of rehearsals) rehearsal.dispose()
    return pmrem.fromScene(room, 0.04).texture
  } finally {
    pmrem.dispose()
  }
}
