// Finish lighting model — three's physical lighting with the direct lights
// scaled by one uniform, a finish's `lightGain`.
//
// The law: a finish can ask for more or less of the key and rim than the
// studio gives every finish, without a rig of its own. Velvet put most of
// its light in the key, at 3.2 times the studio key, and lights are shared
// by every finish on a canvas, because three's WebGPU renderer reads a
// light's uniforms once per frame: on one shared set every card drew under
// the studio that placed the lights last (measured 2026-11-26, one bench
// card switched from velvet to lacquer changed 85% of the pixels of two
// other cards). The gain multiplies each light's color where three's
// PhysicalLightingModel reads it, in `direct` and `directRectArea`, so it
// is a uniform write and reaches every lobe a light feeds. A gain of 1
// multiplies by exactly 1.
//
// Ownership: this module owns the subclass and its uniform. finishNodes
// scales the key's own sheen and scatter by the same uniform.

import { MeshPhysicalNodeMaterial, PhysicalLightingModel, type Node, type NodeBuilder, type UniformNode } from 'three/webgpu'
import { uniform } from 'three/tsl'

type DirectInput = Parameters<PhysicalLightingModel['direct']>[0]
type DirectRectAreaInput = Parameters<PhysicalLightingModel['directRectArea']>[0]

function gained(lightColor: Node, gain: Node<'float'>): Node<'vec3'> {
  // SAFETY: three's light nodes pass lightColor as a vec3 (the light's color
  // times its intensity); its published types leave the node untyped.
  return (lightColor as Node<'vec3'>).mul(gain)
}

class GainedLightingModel extends PhysicalLightingModel {
  readonly #gain: Node<'float'>

  constructor(gain: Node<'float'>, material: MeshPhysicalNodeMaterial) {
    super(
      material.useClearcoat,
      material.useSheen,
      material.useIridescence,
      material.useAnisotropy,
      material.useTransmission,
      material.useDispersion,
      material.useRetroreflection,
    )
    this.#gain = gain
  }

  override direct(input: DirectInput, builder: NodeBuilder): void {
    super.direct({ ...input, lightColor: gained(input.lightColor, this.#gain) }, builder)
  }

  override directRectArea(input: DirectRectAreaInput, builder: NodeBuilder): void {
    super.directRectArea({ ...input, lightColor: gained(input.lightColor, this.#gain) }, builder)
  }
}

/** A MeshPhysicalNodeMaterial whose direct lights are scaled by `lightGain`. */
export class FinishPhysicalMaterial extends MeshPhysicalNodeMaterial {
  readonly lightGain: UniformNode<'float', number> = uniform(1)

  override setupLightingModel(): PhysicalLightingModel {
    return new GainedLightingModel(this.lightGain, this)
  }
}
