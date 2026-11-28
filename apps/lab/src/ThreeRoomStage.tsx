// Shared Three.js room canvas for lab scenes that need the 3D WebGPU room —
// lazily loaded by `App.tsx` so `@petepetrash/munari/gpu` pages never fetch Three/R3F.

import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment, OrbitControls } from '@react-three/drei'
import { ContactShadows } from './lib/ContactShadows'
import { FocusScene, SurfaceCanvas } from '@petepetrash/munari'
import { observeSurfaceSources } from './lib/surfaceFrames'
import { SurfaceProviderProbe } from './lib/surfaceProvider'

observeSurfaceSources()

const Workspace = lazy(() => import('./scenes/workspace/Workspace').then((m) => ({ default: m.Workspace })))
const WorkspaceHud = lazy(() => import('./scenes/workspace/Workspace').then((m) => ({ default: m.WorkspaceHud })))
const Glass = lazy(() => import('./scenes/glass/Glass').then((m) => ({ default: m.Glass })))
const GlassTweakPanel = lazy(() => import('./scenes/glass/GlassTweaks').then((m) => ({ default: m.GlassTweakPanel })))
const Explode = lazy(() => import('./scenes/explode/Explode').then((m) => ({ default: m.Explode })))
const ExplodeHud = lazy(() => import('./scenes/explode/Explode').then((m) => ({ default: m.ExplodeHud })))

function KeepDomFocus() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const noSteal = (e: MouseEvent) => e.preventDefault()
    el.addEventListener('mousedown', noSteal)
    return () => el.removeEventListener('mousedown', noSteal)
  }, [gl])
  return null
}

function Room({ scene }: { readonly scene: string }) {
  return (
    <>
      <Environment files="/hdri/potsdamer_platz_1k.hdr" />
      {scene === 'glass' && <Glass />}
      {scene === 'explode' && <Explode />}
      {scene === 'workspace' && <Workspace />}
      {scene !== 'explode' && scene !== 'glass' && (
        <ContactShadows position={[0, -0.15, 0]} opacity={0.5} blur={2.2} scale={20} />
      )}
      {scene !== 'glass' && (
        <OrbitControls
          makeDefault
          enableDamping
          target={[0, 1.4, 0]}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={3}
          maxDistance={16}
        />
      )}
    </>
  )
}

function SceneHud({ scene }: { readonly scene: string }) {
  if (scene === 'workspace') return <WorkspaceHud />
  if (scene === 'explode') return <ExplodeHud />
  if (scene === 'glass') return <GlassTweakPanel />
  return null
}

export interface ThreeRoomStageProps {
  readonly scene: string
  readonly demand: boolean
  readonly showChrome: boolean
  readonly notice: ReactNode
}

export function ThreeRoomStage({ scene, demand, showChrome, notice }: ThreeRoomStageProps) {
  return (
    <div className="app">
      <SurfaceProviderProbe value="lab">
        <SurfaceCanvas
          frameloop={demand ? 'demand' : 'always'}
          shadows
          camera={{ position: [0, 2.5, 9], fov: 45 }}
          dpr={[1, 2]}
          onCreated={(state) => {
            // Dev diagnostics: lets automation inspect the scene graph.
            window.__r3f = state
          }}
        >
          <KeepDomFocus />
          <FocusScene>
            <Suspense fallback={null}>
              <Room scene={scene} />
            </Suspense>
          </FocusScene>
        </SurfaceCanvas>
      </SurfaceProviderProbe>
      {notice}
      {showChrome && (
        <Suspense fallback={null}>
          <SceneHud scene={scene} />
        </Suspense>
      )}
    </div>
  )
}
