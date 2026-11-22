// Three structurally distinct UI variants for the soft-polymer visual language prototype.
//
// Variant A: Swiss editorial paper-and-ink grid with sparse molded Delrin focal plates.
// Variant B: Braun / OP-1 recessed instrument console with tinted matte polymer keycaps.
// Variant C: Translucent frosted silicone sheets floating at 3 elevations over a drafted grid.

import { useState } from 'react'
import { Button, Ruler, Status, Tag, TextButton } from '../../components/system'
import type { SurfaceCanvasId } from '@petepetrash/munari'
import { PolymerContainer } from './PolymerPrototypeSurface'

export interface VariantProps {
  readonly canvasId: SurfaceCanvasId
  readonly inScene: boolean
}

export function VariantA({ canvasId, inScene }: VariantProps) {
  const [note, setNote] = useState('Type here while dragging the studio light above.')
  const [saves, setSaves] = useState(3)
  const [copied, setCopied] = useState(false)

  return (
    <div className="poly-variant-a">
      <div className="poly-editorial-hero">
        <p className="m-label m-quiet">Variant A · Editorial paper + sparse Delrin plates</p>
        <h1 className="m-display">Paper stays flat. Interactive matter stands proud.</h1>
        <p className="m-lead m-quiet">
          Headlines, rules, and prose remain crisp two-dimensional ink on white paper. Only interactive controls and
          focal capsules occupy molded polymer bodies under one global light.
        </p>

        <PolymerContainer
          canvasId={canvasId}
          inScene={inScene}
          elevationScale={0.85}
          radiusPx={14}
          className="poly-install-bar"
        >
          <code className="m-code">npm install @petepetrash/munari three@0.186.1 --save-exact</code>
          <TextButton
            onClick={() => {
              setCopied(true)
              void navigator.clipboard?.writeText('npm install @petepetrash/munari three@0.186.1 --save-exact').catch(() => {})
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </TextButton>
        </PolymerContainer>
      </div>

      <section className="m-section" aria-label="Interactive polymer specimen">
        <h2>Live specimen</h2>
        <div className="poly-a-body">
          <PolymerContainer
            canvasId={canvasId}
            inScene={inScene}
            elevationScale={1.15}
            className="poly-note-card"
          >
            <div className="poly-card-top">
              <Status status="live">Retained HTML inside lit polymer</Status>
              <Tag>Saves: {saves}</Tag>
            </div>
            <label className="poly-field-label m-label" htmlFor="poly-a-input">
              Editable field (press card to feel cushion dip)
            </label>
            <input
              id="poly-a-input"
              className="poly-text-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="poly-card-foot">
              <span className="m-small m-quiet">Select text or tab here — DOM never clones on light move.</span>
              <Button compact onClick={() => setSaves((n) => n + 1)}>
                Commit note
              </Button>
            </div>
          </PolymerContainer>

          <div className="poly-trio-grid">
            <PolymerContainer canvasId={canvasId} inScene={inScene} elevationScale={0.9} className="poly-mini-card">
              <span className="m-label">01 · Zero-flash handoff</span>
              <p className="m-ui m-quiet">
                Moves via <code className="m-code">moveBefore</code> on the first verified GPU screen draw.
              </p>
            </PolymerContainer>

            <PolymerContainer canvasId={canvasId} inScene={inScene} elevationScale={0.9} className="poly-mini-card">
              <span className="m-label">02 · Radial shadow coherence</span>
              <p className="m-ui m-quiet">
                Notice each tile’s bevel catchlight and penumbra aim away from the same overhead point.
              </p>
            </PolymerContainer>

            <PolymerContainer canvasId={canvasId} inScene={inScene} elevationScale={0.9} className="poly-mini-card">
              <span className="m-label">03 · 0 fps at rest</span>
              <p className="m-ui m-quiet">
                Demand rendering sleeps the instant press springs and light drags settle.
              </p>
            </PolymerContainer>
          </div>
        </div>
      </section>
    </div>
  )
}

const CONSOLE_MODES = [
  { id: 'field', label: 'Field study', freq: '12.0 ms', tint: '#fbfbfa' },
  { id: 'coral', label: 'Warm relay', freq: '0.0 px', tint: '#f6e1dc' },
  { id: 'sky', label: 'Optical pass', freq: '1.33x', tint: '#dfeef7' },
  { id: 'sage', label: 'Demand sleep', freq: '0 fps', tint: '#e6ece2' },
] as const

export function VariantB({ canvasId, inScene }: VariantProps) {
  const [selected, setSelected] = useState<(typeof CONSOLE_MODES)[number]['id']>('field')
  const [query, setQuery] = useState('proiezioni dirette')
  const activeMode = CONSOLE_MODES.find((m) => m.id === selected) ?? CONSOLE_MODES[0]

  return (
    <div className="poly-variant-b">
      <div className="poly-b-head">
        <div>
          <p className="m-label m-quiet">Variant B · Braun / OP-1 modular instrument tray</p>
          <h1 className="m-title">Recessed wells and tinted matte keycaps</h1>
        </div>
        <p className="m-ui m-quiet poly-b-blurb">
          A stone tray groups recessed display cavities beside soft-touch tinted polymer switches.
        </p>
      </div>

      <div className="poly-console-tray">
        <div className="poly-console-left">
          <PolymerContainer
            canvasId={canvasId}
            inScene={inScene}
            recessed
            pressable={false}
            tintHex="#eae8e1"
            radiusPx={14}
            className="poly-recessed-screen"
          >
            <div className="poly-screen-row">
              <span className="m-label m-quiet">Active channel</span>
              <span className="m-readout poly-big-readout">{activeMode.freq}</span>
            </div>
            <Ruler />
            <div className="poly-screen-row">
              <span className="m-ui">
                <b>{activeMode.label}</b> · Global light inverted on recessed cavity bevel
              </span>
              <Tag>{selected.toUpperCase()}</Tag>
            </div>
          </PolymerContainer>

          <PolymerContainer
            canvasId={canvasId}
            inScene={inScene}
            elevationScale={0.75}
            radiusPx={14}
            tintHex="#f8f7f3"
            className="poly-search-pod"
          >
            <label className="m-label" htmlFor="poly-b-query">
              Specimen filter
            </label>
            <input
              id="poly-b-query"
              className="poly-text-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </PolymerContainer>
        </div>

        <div className="poly-keycap-grid" role="group" aria-label="Polymer channel keycaps">
          {CONSOLE_MODES.map((mode) => {
            const isActive = mode.id === selected
            return (
              <PolymerContainer
                key={mode.id}
                canvasId={canvasId}
                inScene={inScene}
                elevationScale={isActive ? 0.52 : 1.25}
                radiusPx={16}
                tintHex={mode.tint}
                className="poly-keycap"
              >
                <button
                  type="button"
                  className="poly-keycap-btn"
                  aria-pressed={isActive}
                  onClick={() => setSelected(mode.id)}
                >
                  <span className="m-label">{mode.label}</span>
                  <span className="m-readout m-quiet">{mode.freq}</span>
                  <span className="m-small m-quiet">{isActive ? 'Latched low (5 px)' : 'Standing (13 px)'}</span>
                </button>
              </PolymerContainer>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function VariantC({ canvasId, inScene }: VariantProps) {
  const [layerNote, setLayerNote] = useState('Underlying drafted grid stays visible through 80% frosted silicone.')

  return (
    <div className="poly-variant-c">
      <div className="poly-c-head">
        <p className="m-label m-quiet">Variant C · Munari translucent PVC sheets over drafted grid</p>
        <h1 className="m-title">Staggered frosted membranes over printed architecture</h1>
      </div>

      <div className="poly-blueprint-sheet">
        <div className="poly-blueprint-marks" aria-hidden>
          <span>00 mm · DATUM A</span>
          <span>SCALE 1:1 CSS PX</span>
          <span>PROIEZIONI DIRETTE · 1950</span>
          <span>GRID 24 × 24 PX</span>
        </div>

        <div className="poly-c-stack">
          <div className="poly-c-col">
            <PolymerContainer
              canvasId={canvasId}
              inScene={inScene}
              elevationScale={0.5}
              opacityOverride={0.82}
              tintHex="#f9fbfd"
              radiusPx={18}
              className="poly-membrane-card"
            >
              <div className="poly-card-top">
                <span className="m-label">Low sheet · 6 px standoff</span>
                <Tag>Tight shadow</Tag>
              </div>
              <p className="m-ui m-quiet">
                Close to the drafted paper: sharp contact edge, narrow penumbra, grid rules faintly diffused beneath.
              </p>
            </PolymerContainer>
          </div>

          <div className="poly-c-col poly-c-col--mid">
            <PolymerContainer
              canvasId={canvasId}
              inScene={inScene}
              elevationScale={1.25}
              opacityOverride={0.8}
              tintHex="#f7fafc"
              radiusPx={20}
              className="poly-membrane-card"
            >
              <div className="poly-card-top">
                <span className="m-label">Mid sheet · 15 px standoff</span>
                <Tag>Live input</Tag>
              </div>
              <input
                aria-label="Membrane note"
                className="poly-text-input"
                value={layerNote}
                onChange={(e) => setLayerNote(e.target.value)}
              />
            </PolymerContainer>
          </div>

          <div className="poly-c-col poly-c-col--high">
            <PolymerContainer
              canvasId={canvasId}
              inScene={inScene}
              elevationScale={2.1}
              opacityOverride={0.78}
              tintHex="#f5f9fc"
              radiusPx={22}
              className="poly-membrane-card"
            >
              <div className="poly-card-top">
                <span className="m-label">High canopy · 25 px standoff</span>
                <Tag>Wide penumbra</Tag>
              </div>
              <p className="m-ui m-quiet">
                Doubling standoff doubles cast-shadow displacement and softens the area-light penumbra naturally.
              </p>
            </PolymerContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
