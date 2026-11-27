// Surface compiled — the compiler each SurfaceCanvas renderer runs, and
// the gate that keeps a presenter's first draw until its pipelines are built.
//
// The law: a Surface presenter draws only once every pipeline its first
// material draws with is built (decisions.md #76 and #80). Outside a
// SurfaceCanvas there is no compiler and it draws at once.
//
// Ownership: this module finds the compiler for a renderer; holding and
// building are surfaceCompile.ts's.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type RootState } from '@react-three/fiber'
import type { WebGPURenderer } from 'three/webgpu'
import { type SurfaceCompilation, type SurfaceCompiler } from './surfaceCompile'

const compilers = new WeakMap<RootState['gl'] | WebGPURenderer, SurfaceCompiler>()

/** Install the compiler SurfaceCanvas runs for its renderer. Returns the uninstall. */
export function installSurfaceCompiler(renderer: WebGPURenderer, compiler: SurfaceCompiler): () => void {
  compilers.set(renderer, compiler)
  return () => {
    if (compilers.get(renderer) === compiler) compilers.delete(renderer)
    compiler.dispose()
  }
}

/** The compiler for a renderer a SurfaceCanvas created; null for any other. */
export function surfaceCompilerOf(renderer: RootState['gl'] | WebGPURenderer): SurfaceCompiler | null {
  return compilers.get(renderer) ?? null
}

/**
 * Whether `mesh` may draw: false until every pipeline its current material
 * draws with is built. Outside a SurfaceCanvas there is no compiler and the
 * answer is true at once. With `wait` false the mesh draws at once too.
 *
 * Only a presenter's first material is held back here, and only when `wait`
 * held at its first frame. Once it draws, the canvas hold keeps its later
 * looks: a material replaced after that draws with the last built one until
 * its own pipelines are built, because hiding a mesh that has drawn would
 * take pixels off a screen the page no longer covers.
 */
export function useSurfaceCompiled(mesh: THREE.Mesh | null, wait = true): boolean {
  const gl = useThree((state) => state.gl)
  const [compiledMesh, setCompiledMesh] = useState<THREE.Mesh | null>(null)
  const pending = useRef<{ readonly mesh: THREE.Mesh; readonly material: THREE.Material; readonly version: number; readonly compilation: SurfaceCompilation } | null>(null)
  const compiled = mesh !== null && compiledMesh === mesh

  useFrame(() => {
    if (!mesh || compiled) return
    const material = mesh.material
    const current = pending.current
    // A version bump while the build runs (a texture or envMap assigned at
    // commit) can change the shader the clones were built with.
    if (current?.mesh === mesh && current.material === material && !Array.isArray(material) && current.version === material.version) return
    current?.compilation.release()
    pending.current = null
    const compiler = surfaceCompilerOf(gl)
    if (!wait || !compiler || Array.isArray(material)) {
      setCompiledMesh(mesh)
      return
    }
    const compilation = compiler.compile(mesh, material)
    const record = { mesh, material, version: material.version, compilation }
    pending.current = record
    void compilation.ready.then(() => {
      if (pending.current !== record) return
      compiler.adopt(mesh, compilation)
      setCompiledMesh(mesh)
    })
  })

  useEffect(
    () => () => {
      pending.current?.compilation.release()
      pending.current = null
    },
    [],
  )
  return compiled || !wait
}
