// Why Munari diagrams — interactive failure-mode specimens comparing DIY code and Munari.
//
// The law: every specimen exposes a real parameter (frame step, wave bend,
// panel width, camera distance, or text selection) and prints measured units in
// tabular numerals, matching the site style guide.
//
// Ownership: `Why.tsx` selects a `DiagramKind` per section; this module owns
// each interactive specimen's local state and SVG rendering.

import { useEffect, useState, type MouseEvent } from 'react'
import { Button, Slider, Status, Tag, Toggle } from '../../components/system'
import type { DiagramKind } from './whyData'

const HANDOFF_STEPS = [
  'Frame 0 · Resting in page flow',
  'Frame 1 · inScene = true (WebGPU pipeline compiling)',
  'Frame 2 · Texture uploaded, off-screen pass running',
  'Frame 3 · First color-writing screen draw lands',
  'Frame 4 · Settled in lit 3D',
] as const

function HandoffTimelineDiagram() {
  const [frame, setFrame] = useState(1)
  const diyBlank = frame === 1 || frame === 2
  const diyLit = frame >= 3
  const munariLit = frame >= 3

  return (
    <div className="why-specimen">
      <div className="why-specimen-controls">
        <div className="why-slider-wrap">
          <Slider label="Handoff frame" min={0} max={4} step={1} value={frame} onChange={setFrame} />
        </div>
        <Button variant="outline" compact onClick={() => setFrame((f) => (f + 1) % 5)}>
          Step frame
        </Button>
        <span className="m-readout m-quiet">{HANDOFF_STEPS[frame]}</span>
      </div>

      <div className="why-compare-boxes">
        <div className="why-box">
          <div className="why-box-head">
            <span className="m-label">DIY React toggle + appendChild</span>
            <Tag>{diyBlank ? '0 px drawn' : diyLit ? 'State lost' : 'Page DOM'}</Tag>
          </div>
          <div className="why-stage-canvas" data-blank={diyBlank || undefined}>
            {diyBlank ? (
              <div className="why-blank-flash">
                <b className="m-label">Blank flash</b>
                <span className="m-small m-quiet">DOM hidden before async shader compile finished</span>
              </div>
            ) : (
              <div className="why-mock-card" data-lit={diyLit || undefined}>
                <div className="why-mock-input">
                  <span>Quarterly notes</span>
                  {!diyLit && <i className="why-mock-selection" aria-hidden />}
                </div>
                <div className="why-mock-scroll m-readout">
                  {diyLit ? 'activeElement: body · scrollTop: 0 px' : 'activeElement: input [0..9] · scrollTop: 120 px'}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="why-box">
          <div className="why-box-head">
            <span className="m-label">Munari &lt;Surface&gt;</span>
            <Tag>{munariLit ? 'Lit 3D · state intact' : 'Page holds pixels'}</Tag>
          </div>
          <div className="why-stage-canvas">
            <div className="why-mock-card" data-lit={munariLit || undefined}>
              <div className="why-mock-input">
                <span>Quarterly notes</span>
                <i className="why-mock-selection" aria-hidden />
              </div>
              <div className="why-mock-scroll m-readout">
                {frame === 1 || frame === 2
                  ? 'GPU warming behind page · caret [0..9] · scrollTop: 120 px'
                  : 'activeElement: input [0..9] · scrollTop: 120 px'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const WAVE_ROWS = ['M-101  Pointer relay twin', 'M-102  Idle-zero demand loop', 'M-103  Premultiplied sRGB', 'M-104  Anchor frame lock', 'M-105  Hysteresis resize', 'M-106  WebKit font cache'] as const

function CurvedHitTestDiagram() {
  const [bend, setBend] = useState(44)
  const [cursorRow, setCursorRow] = useState(2)

  const waveOffset = Math.round(Math.sin(((cursorRow + 0.5) / WAVE_ROWS.length) * Math.PI) * bend)
  const rowShift = Math.round(waveOffset / 28)
  const flatHitRow = Math.min(WAVE_ROWS.length - 1, Math.max(0, cursorRow + rowShift))
  const missPx = Math.abs(waveOffset)

  const onMoveSvg = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const relY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
    const nextRow = Math.min(WAVE_ROWS.length - 1, Math.floor(relY * WAVE_ROWS.length))
    setCursorRow(nextRow)
  }

  return (
    <div className="why-specimen">
      <div className="why-specimen-controls">
        <div className="why-slider-wrap">
          <Slider label="Mesh wave bend" min={0} max={56} step={4} unit="px" value={bend} onChange={setBend} />
        </div>
        <Status status={bend === 0 ? 'live' : 'fallback'}>
          {bend === 0 ? 'Route: native (matrix3d, isTrusted: true)' : 'Route: relay (UV raycast + [data-hover])'}
        </Status>
      </div>

      <div className="why-wave-grid">
        <svg
          className="why-wave-svg"
          viewBox="0 0 420 196"
          role="img"
          aria-label="Curved mesh hit-test comparison. Move pointer across rows to compare flat hit box against deformed vertex raycast."
          onMouseMove={onMoveSvg}
        >
          {WAVE_ROWS.map((label, idx) => {
            const flatY = 14 + idx * 28
            const shift = Math.sin(((idx + 0.5) / WAVE_ROWS.length) * Math.PI) * bend * 0.45
            const curvedX = 36 + shift
            const isTarget = idx === cursorRow
            const isWrongFlat = bend > 0 && idx === flatHitRow && flatHitRow !== cursorRow
            return (
              <g key={label}>
                <rect x={36} y={flatY} width={310} height={24} fill="none" stroke="#dedede" strokeDasharray="3 3" />
                <rect
                  x={curvedX}
                  y={flatY}
                  width={310}
                  height={24}
                  fill={isTarget ? '#000' : '#fff'}
                  stroke={isWrongFlat ? '#f2695c' : '#000'}
                  strokeWidth={isWrongFlat ? 2 : 1}
                />
                <text
                  x={curvedX + 10}
                  y={flatY + 16}
                  fontSize="12"
                  fontFamily="Courier Prime, monospace"
                  fill={isTarget ? '#fff' : '#000'}
                >
                  {label}
                </text>
              </g>
            )
          })}
          <circle
            cx={36 + Math.sin(((cursorRow + 0.5) / WAVE_ROWS.length) * Math.PI) * bend * 0.45 + 294}
            cy={26 + cursorRow * 28}
            r={5}
            fill="#52c7f2"
            stroke="#000"
          />
          {bend > 0 && (
            <circle cx={330} cy={26 + flatHitRow * 28} r={5} fill="#f2695c" stroke="#000" />
          )}
        </svg>

        <dl className="why-readout-list m-ui">
          <div>
            <dt className="m-small m-quiet">Pointer target on bent pixels</dt>
            <dd className="m-readout">{WAVE_ROWS[cursorRow]}</dd>
          </div>
          <div>
            <dt className="m-small m-quiet">DIY vertex-shader hit (flat plane)</dt>
            <dd className="m-readout">
              {missPx === 0 ? '0 px error (plane is flat)' : `Off by ${missPx} px · hits ${WAVE_ROWS[flatHitRow]?.slice(0, 5)}`}
            </dd>
          </div>
          <div>
            <dt className="m-small m-quiet">Munari deformSurfaceGeometry</dt>
            <dd className="m-readout">0 px error · hits {WAVE_ROWS[cursorRow]?.slice(0, 5)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function AnchorSyncDiagram() {
  const [width, setWidth] = useState(320)
  const [uploadedWidth, setUploadedWidth] = useState(320)
  const [premult, setPremult] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setUploadedWidth(width), 220)
    return () => clearTimeout(timer)
  }, [width])

  const drift = Math.abs(width - uploadedWidth)

  return (
    <div className="why-specimen">
      <div className="why-specimen-controls">
        <div className="why-slider-wrap">
          <Slider label="Scrub responsive width" min={220} max={400} step={12} unit="px" value={width} onChange={setWidth} />
        </div>
        <Toggle label="premultipliedOutput" checked={premult} onChange={setPremult} />
      </div>

      <div className="why-compare-boxes">
        <div className="why-box">
          <div className="why-box-head">
            <span className="m-label">DIY getBoundingClientRect + stock material</span>
            <Tag>{drift > 0 ? `Bezel leads by ${drift} px` : 'Dark alpha halo'}</Tag>
          </div>
          <div className="why-anchor-stage">
            <div className="why-anchor-panel" style={{ width: `${Math.round((uploadedWidth / 400) * 100)}%` }}>
              <span className="why-bezel why-bezel--lag" style={{ transform: `translateX(${(width - uploadedWidth) * 0.45}px)` }} />
              <span className="why-html-cta" data-halo={!premult || true}>Save changes</span>
            </div>
          </div>
        </div>

        <div className="why-box">
          <div className="why-box-head">
            <span className="m-label">Munari &lt;Surface.Anchor&gt; + premultipliedOutput</span>
            <Tag>0 px drift · 0/255 sRGB</Tag>
          </div>
          <div className="why-anchor-stage">
            <div className="why-anchor-panel" style={{ width: `${Math.round((uploadedWidth / 400) * 100)}%` }}>
              <span className="why-bezel" />
              <span className="why-html-cta" data-halo={!premult || undefined}>Save changes</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const RESIZE_FRAMES = Array.from({ length: 40 }, (_, i) => i)
const DIY_FILLED = new Set([13, 28])
const MUNARI_CUTS = new Set([0, 11, 23, 35])

function ResizeFilmstripDiagram() {
  const [distance, setDistance] = useState(2.5)
  const lodTier = distance <= 2 ? '2.0x' : distance <= 3.5 ? '1.5x' : '1.0x'

  return (
    <div className="why-specimen">
      <div className="why-specimen-controls">
        <div className="why-slider-wrap">
          <Slider label="Camera distance" min={1.5} max={5.5} step={0.5} unit="m" value={distance} onChange={setDistance} />
        </div>
        <Tag>Active LOD tier: {lodTier}</Tag>
        <Tag>At rest: 0 fps · 0 paints/s</Tag>
      </div>

      <div className="why-filmstrips">
        <div className="why-film-row">
          <div className="why-film-meta">
            <span className="m-label">DIY canvas.width resize per frame</span>
            <span className="m-readout m-quiet">2 / 40 frames painted · 38 blank · 120 fps idle</span>
          </div>
          <div className="why-film-cells" role="img" aria-label="38 of 40 frames blank when resizing canvas.width every frame">
            {RESIZE_FRAMES.map((i) => (
              <span key={i} className="why-film-cell" data-filled={DIY_FILLED.has(i) || undefined} />
            ))}
          </div>
        </div>

        <div className="why-film-row">
          <div className="why-film-meta">
            <span className="m-label">Munari hysteresis band + frameloop=&quot;demand&quot;</span>
            <span className="m-readout m-quiet">40 / 40 frames painted · 4 store cuts · 0 fps idle</span>
          </div>
          <div className="why-film-cells" role="img" aria-label="All 40 frames painted with 4 backing-store cuts across the resize">
            {RESIZE_FRAMES.map((i) => (
              <span
                key={i}
                className="why-film-cell"
                data-filled
                data-cut={MUNARI_CUTS.has(i) || undefined}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ElementCaptureDiagram() {
  const [lensX, setLensX] = useState(46)
  const [selectedChars, setSelectedChars] = useState(0)

  const readSelection = () => {
    const text = window.getSelection()?.toString() ?? ''
    setSelectedChars(text.length)
  }

  return (
    <div className="why-specimen">
      <div className="why-specimen-controls">
        <div className="why-slider-wrap">
          <Slider label="3D glass band position" min={12} max={88} step={2} unit="%" value={lensX} onChange={setLensX} />
        </div>
        <Tag>Selected chars: {selectedChars}</Tag>
        <Tag>React re-renders: 0</Tag>
      </div>

      <div className="why-lens-demo" onMouseUp={readSelection} onKeyUp={readSelection}>
        <p className="m-body">
          Drag across any words in this native paragraph to select them, then slide the glass band. With{' '}
          <code className="m-code">useElementCapture()</code>, the article never enters a canvas: scrolling and text
          selection stay native while the shader samples a mirrored GPU texture in <code className="m-code">useFrame</code>.
        </p>
        <div className="why-lens-band" style={{ left: `${lensX}%` }} aria-hidden>
          <span>1.33x TSL sample</span>
        </div>
      </div>
    </div>
  )
}

function EngineMetricsDiagram() {
  return (
    <div className="why-engine-cards">
      <div className="why-box">
        <div className="why-box-head">
          <span className="m-label">HTML-in-canvas (default)</span>
          <Status status="live">Chrome 157+</Status>
        </div>
        <dl className="why-metrics m-ui">
          <div><dt className="m-quiet">Input to texture (dpr 2)</dt><dd className="m-readout">12 ms</dd></div>
          <div><dt className="m-quiet">Text caret &amp; selection</dt><dd className="m-readout">Painted live</dd></div>
          <div><dt className="m-quiet">Sub-pixel CSS borders</dt><dd className="m-readout">Exact</dd></div>
          <div><dt className="m-quiet">Pointer route &quot;auto&quot;</dt><dd className="m-readout">Native matrix3d</dd></div>
        </dl>
      </div>

      <div className="why-box">
        <div className="why-box-head">
          <span className="m-label">snapDOM fallback</span>
          <Status status="fallback">Safari · Firefox · iOS</Status>
        </div>
        <dl className="why-metrics m-ui">
          <div><dt className="m-quiet">Quiet input to texture</dt><dd className="m-readout">37 ms</dd></div>
          <div><dt className="m-quiet">Safari font pass (cached)</dt><dd className="m-readout">14 ms (was 137 ms)</dd></div>
          <div><dt className="m-quiet">Live animation cap</dt><dd className="m-readout">~4 fps</dd></div>
          <div><dt className="m-quiet">Pointer route</dt><dd className="m-readout">UV relay</dd></div>
        </dl>
      </div>
    </div>
  )
}

export function WhyDiagram({ kind }: { readonly kind: DiagramKind }) {
  switch (kind) {
    case 'handoff':
      return <HandoffTimelineDiagram />
    case 'curve':
      return <CurvedHitTestDiagram />
    case 'anchor':
      return <AnchorSyncDiagram />
    case 'resize':
      return <ResizeFilmstripDiagram />
    case 'capture':
      return <ElementCaptureDiagram />
    case 'engines':
      return <EngineMetricsDiagram />
  }
}
