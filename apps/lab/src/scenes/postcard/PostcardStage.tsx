// The postcard owns its handoff state so it cannot rerender the rest of the site.
// A section-positioned canvas shares the page's compositor scroll transform.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Surface, SurfaceCanvas, useSurfaceHandle } from '@petepetrash/munari'
import { PostcardForm } from './PostcardForm'
import { PostcardMesh, PixelPerfect } from './PostcardMesh'
import { createPaperInteraction } from '../light/lightPaperLaw'
import type { LightFlyerStore } from '../light/lightFlyer'

const FOV = 42

function KeepDomFocus() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const noSteal = (event: MouseEvent) => event.preventDefault()
    el.addEventListener('mousedown', noSteal)
    return () => el.removeEventListener('mousedown', noSteal)
  }, [gl])
  return null
}

export function PostcardStage({ supported, reduced, effectsEnabled, flyer, viewportRef }: { supported: boolean; reduced: boolean; effectsEnabled: boolean; flyer: LightFlyerStore; viewportRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasId = useId()
  const hero = useSurfaceHandle('postcard-hero')
  const [inScene, setInScene] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const landRef = useRef(false)
  const paper = useMemo(createPaperInteraction, [])
  return (
    <div className="postcard-section">
      {supported && effectsEnabled && (
        <SurfaceCanvas
          id={canvasId}
          flat
          pointerMode="surfaces"
          style={{
            position: 'absolute', right: 'calc(-1 * var(--light-side-padding))', top: -128,
            width: 'min(var(--demo-width), calc(100% + 256px))', height: 'calc(100% + 256px)',
            zIndex: 10,
          }}
          className="postcard-canvas"
          gl={{ alpha: true }}
          frameloop={inScene && !reduced ? 'always' : 'demand'}
          camera={{ fov: FOV, position: [0, 0, 1000] }}
          onCreated={(state) => state.gl.setClearAlpha(0)}
        >
          <KeepDomFocus />
          <PixelPerfect fov={FOV} />
          <Surface.Scene surface={hero}>
            <PostcardMesh
              flyer={flyer}
              viewportRef={viewportRef}
              surface={hero}
              paper={paper}
              holderRef={holderRef}
              reduced={reduced}
              landRef={landRef}
              onLanded={() => setInScene(false)}
            />
          </Surface.Scene>
        </SurfaceCanvas>
      )}
      <PostcardForm
        flyer={flyer}
        canvasId={canvasId}
        surface={hero}
        paper={paper}
        inScene={inScene}
        setInScene={setInScene}
        holderRef={holderRef}
        landRef={landRef}
        supported={supported}
        reduced={reduced}
      />
    </div>
  )
}
