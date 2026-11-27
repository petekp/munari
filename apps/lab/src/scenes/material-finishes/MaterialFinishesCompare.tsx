// Preset comparison — each preset of one material in its own live frame,
// side by side, so the presets can be judged against each other under the
// same rig (?scene=material-finishes&compare=<family id>&text=&light=).
//
// Each frame is a full 1440×900 copy of the scene without its controls,
// scaled to half size, which keeps the cards' layout and the light's
// placement the same as the full page.

import { useEffect } from 'react'
import { FINISH_FAMILIES, type FinishFamily } from './materialFinishesFamilies'
import { FINISH_ORDER, isLightRig } from './materialFinishesTuning'

// The scene's layout and light placement are tuned at this viewport.
const FRAME_WIDTH = 1440
const FRAME_HEIGHT = 900
const FRAME_SCALE = 0.5

function sceneQuery(entries: Record<string, string>): string {
  return `?${new URLSearchParams({ scene: 'material-finishes', ...entries })}`
}

export function MaterialFinishesCompare({ family, onReady }: { readonly family: FinishFamily; readonly onReady?: () => void }) {
  const params = new URLSearchParams(window.location.search)
  const text = params.get('text') === 'lit' ? 'lit' : 'unlit'
  const lightParam = params.get('light')
  const light = isLightRig(lightParam) ? lightParam : 'softbox'

  useEffect(() => {
    requestAnimationFrame(() => onReady?.())
  }, [onReady])

  return (
    <div className="mf-compare">
      <header className="mf-compare-header">
        <h1 className="mf-compare-title">{family.label}: {family.presets.length} presets</h1>
        <nav className="mf-compare-nav" aria-label="Material">
          {FINISH_FAMILIES.map((item) => (
            <a key={item.id} href={sceneQuery({ compare: item.id, text, light })} aria-current={item.id === family.id ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <p className="mf-compare-note">
          {text === 'lit' ? 'Lit text' : 'Unlit text'} under the {light} rig. Each frame is live: drag its light, or open it full size.
        </p>
      </header>
      <div className="mf-compare-grid">
        {family.presets.map((preset) => {
          const label = FINISH_ORDER.find((item) => item.id === preset.id)?.label ?? preset.id
          const full = sceneQuery({ finish: preset.id, text, light })
          return (
            <figure key={preset.id} className="mf-compare-item">
              <div className="mf-compare-frame" style={{ width: FRAME_WIDTH * FRAME_SCALE, height: FRAME_HEIGHT * FRAME_SCALE }}>
                <iframe
                  title={label}
                  src={`${full}&bare`}
                  width={FRAME_WIDTH}
                  height={FRAME_HEIGHT}
                  style={{ transform: `scale(${FRAME_SCALE})` }}
                />
              </div>
              <figcaption>
                <a href={full}>{label}</a> <code>finish={preset.id}</code>
                <span>{preset.intent}</span>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
