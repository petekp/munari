// Look comparison — each of one finish's looks in its own live frame, side
// by side, so the looks can be judged against each other under the same
// rig (?scene=material-finishes&compare=<finish id>&text=&light=).
//
// The law: a look sets studio values and the environment along with the
// finish, and the page has one studio, so the looks cannot share a canvas.
// Each frame is a full 1440×900 copy of the scene without its controls,
// scaled to half size, which keeps the cards' layout and the light's
// placement the same as the full page.

import { useEffect } from 'react'
import { FINISH_LOOKS, FINISH_ORDER, isLightRig, type FinishId } from './materialFinishesTuning'

// The scene's layout and light placement are tuned at this viewport.
const FRAME_WIDTH = 1440
const FRAME_HEIGHT = 900
const FRAME_SCALE = 0.5

function sceneQuery(entries: Record<string, string>): string {
  return `?${new URLSearchParams({ scene: 'material-finishes', ...entries })}`
}

export function MaterialFinishesCompare({ finish, onReady }: { readonly finish: FinishId; readonly onReady?: () => void }) {
  const params = new URLSearchParams(window.location.search)
  const text = params.get('text') === 'lit' ? 'lit' : 'unlit'
  const lightParam = params.get('light')
  const light = isLightRig(lightParam) ? lightParam : 'softbox'
  const label = FINISH_ORDER.find((item) => item.id === finish)?.label ?? finish

  useEffect(() => {
    requestAnimationFrame(() => onReady?.())
  }, [onReady])

  return (
    <div className="mf-compare">
      <header className="mf-compare-header">
        <h1 className="mf-compare-title">{label}: {FINISH_LOOKS[finish].length} looks</h1>
        <nav className="mf-compare-nav" aria-label="Finish">
          {FINISH_ORDER.map((item) => (
            <a key={item.id} href={sceneQuery({ compare: item.id, text, light })} aria-current={item.id === finish ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <p className="mf-compare-note">
          {text === 'lit' ? 'Lit text' : 'Unlit text'} under the {light} rig. Each frame is live: drag its light, or open it full size.
        </p>
      </header>
      <div className="mf-compare-grid">
        {FINISH_LOOKS[finish].map((look) => {
          const full = sceneQuery({ finish, look: look.id, text, light })
          return (
            <figure key={look.id} className="mf-compare-item">
              <div className="mf-compare-frame" style={{ width: FRAME_WIDTH * FRAME_SCALE, height: FRAME_HEIGHT * FRAME_SCALE }}>
                <iframe
                  title={`${label}, ${look.label}`}
                  src={`${full}&bare`}
                  width={FRAME_WIDTH}
                  height={FRAME_HEIGHT}
                  style={{ transform: `scale(${FRAME_SCALE})` }}
                />
              </div>
              <figcaption>
                <a href={full}>{look.label}</a> <code>look={look.id}</code>
                <span>{look.intent}</span>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
