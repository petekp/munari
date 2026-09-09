// Postcard stock — live print on the front, unprinted paper on the reverse.
// The postcard's CSS layer stays above the heading in both presentations;
// lighting heights must not punch heading-shaped holes into the sheet (#50).

import { useMemo } from 'react'
import * as THREE from 'three'
import { useSurfaceTexture } from '@petepetrash/munari'

export function HomePostcardMaterial() {
  const texture = useSurfaceTexture()
  const compile = useMemo(() => (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      if(!gl_FrontFacing){outgoingLight=vec3(.84,.81,.74);diffuseColor.a=1.0;}
      #include <opaque_fragment>
    `)
  }, [])
  // One pass preserves gl_FrontFacing. Three's transparent two-pass path flips
  // winding for its back pass, which would print the front on the reverse (#51).
  return <meshBasicMaterial map={texture} transparent premultipliedAlpha toneMapped={false} side={THREE.DoubleSide} forceSinglePass onBeforeCompile={compile} />
}
