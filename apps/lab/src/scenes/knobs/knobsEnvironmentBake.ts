// Environment bake — the PMREM generator that refreshes the art
// environment, handed over only once its pipelines are built.
//
// The law: the bake's pipelines are built off the frame first, so the first
// refresh blocks nothing (decisions.md #81). The dry run's target is the
// environment from the start: every material keys its build on the
// environment, and one set later rebuilt each of them (15 node builds became
// 80, m2, 2026-11-26).
//
// Ownership: ArtEnvironment refreshes the environment each frame; this
// module creates the generator and disposes it with the target and picture.

import { useEffect } from 'react'
import type * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import { prebuildPipelines } from '@petepetrash/munari/advanced'

export interface EnvironmentBakeState {
  readonly tex: THREE.Texture
  pmrem: PMREMGenerator | null
  rt: THREE.RenderTarget | null
}

export function useEnvironmentBake(state: EnvironmentBakeState): void {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    // Fiber types the renderer as WebGLRenderer; SurfaceCanvas supplies a
    // WebGPURenderer, whose PMREM generator builds node materials.
    if (!(gl instanceof WebGPURenderer)) throw new Error('Knobs needs the WebGPURenderer from SurfaceCanvas')
    const generator = new PMREMGenerator(gl)
    let live = true
    const prebuilt = prebuildPipelines(gl, () => {
      const target = generator.fromEquirectangular(state.tex)
      state.rt = target
      scene.environment = target.texture
    })
    void prebuilt.then(() => {
      if (live) state.pmrem = generator
    })
    return () => {
      live = false
      scene.environment = null
      const target = state.rt
      state.rt = null
      state.pmrem = null
      // The pending builds read the target and the picture until they settle.
      void prebuilt.finally(() => {
        target?.dispose()
        generator.dispose()
        state.tex.dispose()
      })
    }
  }, [gl, scene, state])
}
