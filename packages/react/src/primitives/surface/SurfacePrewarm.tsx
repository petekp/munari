// Surface prewarm — the render pipelines of presenters that have not mounted
// yet, built while nothing waits on them.
//
// The law: a presenter's first draw waits until its pipelines are built
// (surfaceCompile.ts). Built at that moment, they cost the user the compile
// time, during which the page copy holds. Built here, at load, the same
// pipelines are already in three's cache when the presenter mounts, and its
// own compile resolves without a build.
//
// The fault, 2026-11-22 (instruments/genie-first-flight): with shaders no cache
// held, Genie's first flight blocked for 183-250 ms on pipeline builds. Built
// asynchronously at the flight, the window would instead wait that long
// before it moved.
//
// A pipeline is keyed by the shader and the draw state, never by the bound
// texture, so the meshes here wear the presenter's materials around
// stand-in textures: `useSurfaceTexture` and `useSurfaceNodes` read one,
// and `useFrameTexture` another. They must differ: a material sampling one
// texture through two nodes compiles to a shader with one binding, which is
// not the shader the presenter draws with. The material slot is a presenter's with no
// radius and the given alpha policy. Materials are held to the library's
// premultiplied blending, as Surface.Mesh holds its own (decisions.md #5).
//
// Ownership: this component chooses what to build and says when it is
// built; surfaceCompile.ts builds it. The children are never drawn.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { uniform } from 'three/tsl'
import { useFrame, useThree } from '@react-three/fiber'
import { SurfaceContext, type SurfaceContextValue } from '../SurfaceContext'
import { SurfaceMaterialContext, SurfacePrewarmContext, type SurfaceMaterialValue } from './surfaceContext'
import { configureSurfaceMaterial } from './surfaceMaterials'
import { surfaceCompilerOf, type SurfaceCompilation } from './surfaceCompile'
import { useLatest } from '../useLatest'
import type { SurfaceFinish } from './surfaceFinish'
import { DeferredFinishMaterial } from './finishLoader'

export interface SurfacePrewarmProps {
  /**
   * Meshes wearing the materials later presenters will draw with, on
   * geometry with the same attributes. They are never drawn.
   */
  children?: ReactNode
  /** The `alpha` of the Surface.Mesh presenters these stand for. */
  alpha?: 'opaque' | 'source'
  /** Called once, when every pipeline is built. */
  onReady?: () => void
  /**
   * Finishes later Surfaces will wear on this canvas, each built on a plane
   * with the canvas's lighting, so their first draws build nothing.
   */
  finishes?: readonly SurfaceFinish[]
}

function standInTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.premultiplyAlpha = true
  return texture
}

const noDrawCallbacks = () => () => {}

function PrewarmFinish({ finish }: { readonly finish: SurfaceFinish }) {
  return (
    <mesh>
      <planeGeometry args={[1, 1]} />
      <DeferredFinishMaterial finish={finish} />
    </mesh>
  )
}

export function SurfacePrewarm({ children, alpha = 'opaque', onReady, finishes }: SurfacePrewarmProps) {
  const gl = useThree((state) => state.gl)
  const [texture] = useState(standInTexture)
  const [frameTexture] = useState(standInTexture)
  useEffect(
    () => () => {
      texture.dispose()
      frameTexture.dispose()
    },
    [texture, frameTexture],
  )
  const frame = useMemo<SurfaceContextValue>(() => ({ texture: frameTexture }), [frameTexture])
  // A finish holds until the canvas's environment is baked, so the build
  // here waits for every hold to release.
  const [holds, setHolds] = useState(0)
  const slot = useMemo<SurfaceMaterialValue>(
    () => ({
      radii: uniform(new THREE.Vector4()),
      size: uniform(new THREE.Vector2(1, 1)),
      transparent: alpha === 'source',
      beforeDraw: noDrawCallbacks,
      hold() {
        setHolds((count) => count + 1)
        return () => setHolds((count) => count - 1)
      },
      // A finish is built for a page-declared Surface.Mesh, which matches its
      // DOM box unless told otherwise.
      facesCamera: true,
      finish: null,
    }),
    [alpha],
  )
  const [group, setGroup] = useState<THREE.Group | null>(null)
  const compilations = useRef<SurfaceCompilation[] | null>(null)
  const onReadyRef = useLatest(onReady)

  useFrame(() => {
    if (!group || compilations.current || holds > 0) return
    const compiler = surfaceCompilerOf(gl)
    const started: SurfaceCompilation[] = []
    if (compiler) {
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
        configureSurfaceMaterial(object.material)
        started.push(compiler.compile(object, object.material))
      })
    }
    compilations.current = started
    void Promise.all(started.map((compilation) => compilation.ready)).then(() => {
      if (compilations.current === started) onReadyRef.current?.()
    })
  })

  useEffect(
    () => () => {
      for (const compilation of compilations.current ?? []) compilation.release()
      compilations.current = null
    },
    [],
  )

  return (
    <SurfacePrewarmContext value={texture}>
      <SurfaceMaterialContext value={slot}>
        <SurfaceContext value={frame}>
          <group ref={setGroup} visible={false}>
            {children}
            {finishes?.map((finish, index) => <PrewarmFinish key={index} finish={finish} />)}
          </group>
        </SurfaceContext>
      </SurfaceMaterialContext>
    </SurfacePrewarmContext>
  )
}
