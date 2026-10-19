// Hero stage — the chosen demo, running live in its own frame.
// Demos are laid out for a desktop window, so the frame renders at a fixed
// width and is scaled down to the stage: a desktop width on wide screens, a
// narrower one on phones so the text stays legible. The stage is never taller
// than the window, so the whole demo fits on screen; a capped frame lays the
// demo out at the shorter height instead of cropping it. `capture=auto` keeps
// HTML-in-canvas where the browser has it and captures through snapDOM
// everywhere else.
import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import type { Demo } from '../../components/sceneCatalog'
import { sceneUrl } from '../../captureMode'

// The narrowest width each demo keeps its desktop composition at, and the
// narrower width a phone-sized stage scales down from.
const DESKTOP_WIDTH = 1100
const PHONE_WIDTH = 720
const NARROW_STAGE = 560

export function HomeStage({ demo, ref }: { demo: Demo; ref?: Ref<HTMLElement> }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  const [loaded, setLoaded] = useState('')

  useLayoutEffect(() => {
    const measure = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const observer = new ResizeObserver(() => setWidth(panel.clientWidth))
    observer.observe(panel)
    setWidth(panel.clientWidth)
    return () => observer.disconnect()
  }, [])

  const narrow = width < NARROW_STAGE
  const frameWidth = Math.max(width, narrow ? PHONE_WIDTH : DESKTOP_WIDTH)
  const scale = frameWidth ? width / frameWidth : 1
  const stageHeight = Math.round(Math.min(width * (narrow ? 1 : 0.6), windowHeight))
  const frameHeight = Math.round(stageHeight / scale)

  return (
    <figure ref={ref} className="home-stage" aria-label={`${demo.title} demo`}>
      <div ref={panelRef} className="home-stage-panel" style={{ height: stageHeight || undefined }}>
        <img className="home-stage-poster" src={`/thumbs/${demo.id}.jpg`} alt="" aria-hidden />
        {width > 0 && (
          <iframe
            key={demo.id}
            className="home-stage-frame"
            title={`${demo.title} demo`}
            src={sceneUrl(demo.id, { framed: true, bare: true, capture: 'auto' })}
            data-loaded={loaded === demo.id || undefined}
            onLoad={() => setLoaded(demo.id)}
            style={{ width: frameWidth, height: frameHeight, transform: `scale(${scale})` }}
          />
        )}
      </div>
      <figcaption className="home-stage-caption">
        <p><b>{demo.title}.</b> {demo.instruction}</p>
        <a href={sceneUrl(demo.id, { capture: 'auto' })}>Open full page</a>
      </figcaption>
    </figure>
  )
}
