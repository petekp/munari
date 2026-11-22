// Retained HTML architecture board for `FrontierPatchbay` — six `data-munari-anchor`
// ports across two signal banks with live circuit routing badges and keyboard `onClick`.

import type { Ref } from 'react'

export type SourcePortId = 'port:dom-alpha' | 'port:anchor-uv' | 'port:bg-capture'
export type TargetPortId = 'port:sdf-bevel' | 'port:snell-rim' | 'port:demand-pass'
export type AnyPortId = SourcePortId | TargetPortId

export const ALL_PORTS: readonly AnyPortId[] = [
  'port:dom-alpha',
  'port:anchor-uv',
  'port:bg-capture',
  'port:sdf-bevel',
  'port:snell-rim',
  'port:demand-pass',
]

export const SOURCE_SHORT_LABEL = {
  'port:dom-alpha': 'J1 · Alpha',
  'port:bg-capture': 'J2 · Capture',
  'port:anchor-uv': 'J3 · Anchor',
} satisfies Record<SourcePortId, string>

export interface PatchView {
  readonly id: string
  readonly from: SourcePortId
  readonly to: TargetPortId
  readonly color: string
}

export function FrontierPatchbayBoard({
  boardRef,
  columns,
  expandedNotes,
  armedSource,
  patches,
  onArmSource,
  onSelectTarget,
}: {
  readonly boardRef?: Ref<HTMLDivElement>
  readonly columns: 'wide' | 'split'
  readonly expandedNotes: boolean
  readonly armedSource: SourcePortId | null
  readonly patches: readonly PatchView[]
  readonly onArmSource: (id: SourcePortId) => void
  readonly onSelectTarget: (id: TargetPortId) => void
}) {
  const sourceForTarget = (target: TargetPortId): string => {
    const connected = patches.filter((p) => p.to === target)
    if (connected.length === 0) return 'Unpatched'
    return connected.map((p) => SOURCE_SHORT_LABEL[p.from]).join(' + ')
  }

  return (
    <div ref={boardRef} className={`frontier-patchbay-board frontier-patchbay-board--${columns}`}>
      <section className="frontier-patch-bank" aria-label="DOM signal sources">
        <div className="frontier-patch-bank-head">
          <span className="m-label">Bank A · Live DOM outputs</span>
          <span className="m-small m-quiet">Frame-locked UVs</span>
        </div>

        <div className="frontier-patch-row">
          <div>
            <b>J1 · Glyph &amp; silhouette alpha</b>
            <p className="m-small m-quiet">
              Reads <code>surfaceNodes.alpha</code> from the compositor paint.
              {expandedNotes && ' Drives Sobel heightfields and edge masks without extra DOM passes.'}
            </p>
          </div>
          <button
            type="button"
            className="frontier-port-btn"
            aria-pressed={armedSource === 'port:dom-alpha'}
            aria-label="Arm J1 Glyph alpha output port"
            onClick={() => onArmSource('port:dom-alpha')}
          >
            <span>Out</span>
            <span className="frontier-jack-hole" data-munari-anchor="port:dom-alpha" />
          </button>
        </div>

        <div className="frontier-patch-row">
          <div>
            <b>J2 · In-place article capture</b>
            <p className="m-small m-quiet">
              Mirrors native prose via <code>useElementCapture()</code>.
              {expandedNotes && ' Keeps native scrolling and selection intact underneath glass.'}
            </p>
          </div>
          <button
            type="button"
            className="frontier-port-btn"
            aria-pressed={armedSource === 'port:bg-capture'}
            aria-label="Arm J2 Article capture output port"
            onClick={() => onArmSource('port:bg-capture')}
          >
            <span>Out</span>
            <span className="frontier-jack-hole" data-munari-anchor="port:bg-capture" />
          </button>
        </div>

        <div className="frontier-patch-row">
          <div>
            <b>J3 · Anchor transaction</b>
            <p className="m-small m-quiet">
              Commits <code>Surface.Anchor</code> boxes with the uploaded texture.
              {expandedNotes && ' Eliminates 1-frame ResizeObserver lead during responsive reflow.'}
            </p>
          </div>
          <button
            type="button"
            className="frontier-port-btn"
            aria-pressed={armedSource === 'port:anchor-uv'}
            aria-label="Arm J3 Anchor transaction output port"
            onClick={() => onArmSource('port:anchor-uv')}
          >
            <span>Out</span>
            <span className="frontier-jack-hole" data-munari-anchor="port:anchor-uv" />
          </button>
        </div>
      </section>

      <section className="frontier-patch-bank" aria-label="WebGPU shader stages">
        <div className="frontier-patch-bank-head">
          <span className="m-label">Bank B · TSL shader stages</span>
          <span className="m-small m-quiet">0 fps when settled</span>
        </div>

        <div className="frontier-patch-row frontier-patch-row--target">
          <button
            type="button"
            className="frontier-port-btn"
            aria-label={`Patch into Analytical bevel input (${sourceForTarget('port:sdf-bevel')})`}
            onClick={() => onSelectTarget('port:sdf-bevel')}
          >
            <span className="frontier-jack-hole" data-munari-anchor="port:sdf-bevel" />
            <span>In</span>
          </button>
          <div className="frontier-patch-target-meta">
            <div className="frontier-patch-target-head">
              <b>Analytical bevel &amp; deboss</b>
              <span className="frontier-circuit-pill" data-live={sourceForTarget('port:sdf-bevel') !== 'Unpatched' || undefined}>
                {sourceForTarget('port:sdf-bevel')}
              </span>
            </div>
            <p className="m-small m-quiet">
              Computes rounded-box &amp; Sobel normals in one pass.
              {expandedNotes && ' Zero shadow maps or multi-pass blur pyramids required.'}
            </p>
          </div>
        </div>

        <div className="frontier-patch-row frontier-patch-row--target">
          <button
            type="button"
            className="frontier-port-btn"
            aria-label={`Patch into Snell rim input (${sourceForTarget('port:snell-rim')})`}
            onClick={() => onSelectTarget('port:snell-rim')}
          >
            <span className="frontier-jack-hole" data-munari-anchor="port:snell-rim" />
            <span>In</span>
          </button>
          <div className="frontier-patch-target-meta">
            <div className="frontier-patch-target-head">
              <b>Snell rim &amp; RGB prism</b>
              <span className="frontier-circuit-pill" data-live={sourceForTarget('port:snell-rim') !== 'Unpatched' || undefined}>
                {sourceForTarget('port:snell-rim')}
              </span>
            </div>
            <p className="m-small m-quiet">
              Refracts background UVs with 3-channel wavelength split.
              {expandedNotes && ' Preserves high-contrast frosted center for foreground text.'}
            </p>
          </div>
        </div>

        <div className="frontier-patch-row frontier-patch-row--target">
          <button
            type="button"
            className="frontier-port-btn"
            aria-label={`Patch into Demand output (${sourceForTarget('port:demand-pass')})`}
            onClick={() => onSelectTarget('port:demand-pass')}
          >
            <span className="frontier-jack-hole" data-munari-anchor="port:demand-pass" />
            <span>In</span>
          </button>
          <div className="frontier-patch-target-meta">
            <div className="frontier-patch-target-head">
              <b>Premultiplied demand output</b>
              <span className="frontier-circuit-pill" data-live={sourceForTarget('port:demand-pass') !== 'Unpatched' || undefined}>
                {sourceForTarget('port:demand-pass')}
              </span>
            </div>
            <p className="m-small m-quiet">
              Writes color-exact sRGB and sleeps once damped.
              {expandedNotes && ' Drops to 0 fps on desktop and mobile the instant springs rest.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
