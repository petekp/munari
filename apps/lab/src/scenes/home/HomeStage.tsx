// Hero stage — the chosen demo, running live in its own frame.
// Demos are laid out for a desktop window, so the frame renders at a fixed
// width and is scaled down to the panel: a desktop width on wide screens, a
// narrower one on phones so the text stays legible. `capture=auto` keeps HTML-in-canvas where the browser has it and
// captures through snapDOM everywhere else.
import { useLayoutEffect, useRef, useState } from 'react'
import { exampleFor } from '../../components/sceneCatalog'

// The narrowest width each demo keeps its desktop composition at, and the
// narrower width a phone-sized panel scales down from.
const DESKTOP_WIDTH = 1000
const PHONE_WIDTH = 720
const NARROW_PANEL = 500

type StageStyle = React.CSSProperties & { '--stage-wash': string }

export function HomeStage({ demo }: { demo: string }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [loaded, setLoaded] = useState('')
  const example = exampleFor(demo)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const observer = new ResizeObserver(() => setWidth(panel.clientWidth))
    observer.observe(panel)
    setWidth(panel.clientWidth)
    return () => observer.disconnect()
  }, [])

  const narrow = width < NARROW_PANEL
  const frameWidth = Math.max(width, narrow ? PHONE_WIDTH : DESKTOP_WIDTH)
  const frameHeight = Math.round(frameWidth * (narrow ? 0.9 : 0.64))
  const scale = frameWidth ? width / frameWidth : 1
  const stageStyle: StageStyle = { '--stage-wash': example?.wash ?? '#e3ec5a' }

  return (
    <figure className="home-stage" style={stageStyle}>
      <div ref={panelRef} className="home-stage-panel" style={{ height: frameHeight * scale || undefined }}>
        <img className="home-stage-poster" src={`/thumbs/${demo}.jpg`} alt="" aria-hidden />
        {width > 0 && (
          <iframe
            key={demo}
            className="home-stage-frame"
            title={`${example?.title ?? demo} demo`}
            src={`/?scene=${demo}&framed&bare&capture=auto`}
            data-loaded={loaded === demo || undefined}
            onLoad={() => setLoaded(demo)}
            style={{ width: frameWidth, height: frameHeight, transform: `scale(${scale})` }}
          />
        )}
      </div>
      <figcaption className="home-stage-caption">
        <span>{example?.instruction}</span>
        <a href={`/?scene=${demo}&capture=auto`}>Open {example?.title ?? demo}</a>
      </figcaption>
    </figure>
  )
}
