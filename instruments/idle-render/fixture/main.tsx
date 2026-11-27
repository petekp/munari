// The page half of the idle-render fixture: twelve Surfaces in the scene on
// one SurfaceCanvas, and one mesh that the author animates in useFrame.
//
// ?frameloop=default leaves the prop unset (today's "always"); "demand" sets it.
// ?animation=
//   none             no author animation
//   spin             rotation advances by delta in useFrame and nothing else
//   spin-invalidate  the same, and useFrame calls invalidate() every frame
//   settle           eases to a target set by kick() with delta clamped to
//                    1/30 s, calling invalidate() only while the gap is open
import { useEffect, useId, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh } from 'three'
import { Surface, SurfaceCanvas, useCaptureSupport } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

const query = new URLSearchParams(location.search)
const frameloop = query.get('frameloop') === 'demand' ? 'demand' : undefined
const animation = query.get('animation') ?? 'none'
const CARDS = 12

interface Fixture {
  ready: () => boolean
  presented: () => number
  rotation: () => number
  kick: () => void
  lost: () => boolean
}

declare global {
  interface Window {
    __fixture?: Fixture
  }
}

const state = { rotation: Number.NaN, kick: () => {}, lost: false }

function AuthorMesh() {
  const mesh = useRef<Mesh>(null)
  const target = useRef(0)
  const invalidate = useThree((root) => root.invalidate)
  useEffect(() => {
    state.kick = () => {
      target.current += Math.PI / 2
      invalidate()
    }
  }, [invalidate])
  useFrame((root, delta) => {
    const current = mesh.current
    if (!current) return
    if (animation === 'spin' || animation === 'spin-invalidate') current.rotation.y += delta
    if (animation === 'spin-invalidate') root.invalidate()
    if (animation === 'settle') {
      const gap = target.current - current.rotation.y
      // The first frame after an idle gap carries the whole gap as delta.
      const step = Math.min(delta, 1 / 30)
      current.rotation.y = Math.abs(gap) < 1e-3 ? target.current : current.rotation.y + gap * Math.min(1, step * 6)
      if (current.rotation.y !== target.current) root.invalidate()
    }
    state.rotation = current.rotation.y
  })
  return (
    <mesh ref={mesh} position={[0, -1.5, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshNormalMaterial />
    </mesh>
  )
}

function App() {
  const canvasId = useId()
  const supported = useCaptureSupport()
  const [generation, setGeneration] = useState(0)
  return (
    <main>
      {supported && (
        <SurfaceCanvas
          key={generation}
          id={canvasId}
          pointerMode="surfaces"
          frameloop={frameloop}
          style={{ position: 'absolute', inset: 0 }}
          onRendererLost={() => {
            state.lost = true
            setGeneration((value) => value)
          }}
        >
          {animation !== 'none' && <AuthorMesh />}
        </SurfaceCanvas>
      )}
      <div className="cards">
        {Array.from({ length: CARDS }, (_, index) => (
          <Surface key={index} canvasId={canvasId} inScene={supported}>
            <div className="card">
              <strong>Card {index + 1}</strong>
              <div>Nothing here changes while the page is idle.</div>
            </div>
          </Surface>
        ))}
      </div>
    </main>
  )
}

// The page copies, not the copies the library parks for capture. A page copy
// is hidden while its Surface presents in the scene.
const pageCards = () => [...document.querySelectorAll('.card')].filter((card) => !card.closest('[data-munari-source-host]'))
const presented = () => pageCards().filter((card) => getComputedStyle(card).visibility === 'hidden').length

window.__fixture = {
  ready: () => presented() === CARDS,
  presented,
  rotation: () => state.rotation,
  kick: () => state.kick(),
  lost: () => state.lost,
}

const root = document.getElementById('root')
if (!root) throw new Error('idle-render fixture: #root is missing')
createRoot(root).render(<App />)
