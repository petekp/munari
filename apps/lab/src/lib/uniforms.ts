// A texture uniform starts empty and fills in on the first pass, which is
// one line of type that every shader scene in this lab would otherwise
// restate. Inference alone cannot do it: a bare `{ value: null }` freezes
// `null` into the slot's type and then refuses the texture that arrives.
//
// `glassSdf.tsx` keeps its own copy on purpose — that file is welded
// byte-for-byte to its registry twin, and the twin cannot import from here.

import type * as THREE from 'three'

/** A texture uniform slot: empty at construction, filled at render. */
export interface TextureSlot {
  value: THREE.Texture | null
}

export const textureSlot = (): TextureSlot => ({ value: null })
