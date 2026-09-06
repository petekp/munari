// The postcard owns its handoff state so it cannot rerender the rest of the site.
// A section-positioned canvas shares the page's compositor scroll transform.
import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Surface, SurfaceCanvas, useSurfaceHandle } from '@petepetrash/munari'
import { HeroMesh, HeroSection, PixelPerfect } from './HomeHero'

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

export function HomePostcard({ supported, reduced }: { supported: boolean; reduced: boolean }) {
  const hero = useSurfaceHandle('home-hero')
  const [inScene, setInScene] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const landRef = useRef(false)
  return (
    <div className="home-postcard-section">
      {supported && (
        <SurfaceCanvas
          id="home"
          flat
          pointerMode="surfaces"
          style={{
            position: 'absolute', left: '50%', top: -64,
            width: 'min(100vw, calc(100% + 128px))', height: 'calc(100% + 128px)',
            transform: 'translateX(-50%)', zIndex: 30,
          }}
          className="home-canvas"
          gl={{ alpha: true }}
          frameloop={inScene && !reduced ? 'always' : 'demand'}
          camera={{ fov: FOV, position: [0, 0, 1000] }}
          onCreated={(state) => state.gl.setClearAlpha(0)}
        >
          <KeepDomFocus />
          <PixelPerfect fov={FOV} />
          <Surface.Scene surface={hero}>
            <HeroMesh
              surface={hero}
              holderRef={holderRef}
              reduced={reduced}
              landRef={landRef}
              onLanded={() => setInScene(false)}
            />
          </Surface.Scene>
        </SurfaceCanvas>
      )}
      <HeroSection
        surface={hero}
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
