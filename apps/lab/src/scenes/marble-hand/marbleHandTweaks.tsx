// Marble-hand controls — native instruments around a parked sculpture.
//
// The law: controls remain native above the scene. The hand must
// remain visible and still while a slider changes its pose or material.
// The 2026-08-30 pointer study fixed the tip to the mouse; carrying that
// behavior into an overlay would put the sculpture underneath its controls.
//
// Ownership: the scene owns one live settings object and preview state.
// This panel owns input drafts and disclosure, not a second tuning store.

import { useLayoutEffect, useRef, useState } from 'react'
import {
  MARBLE_HAND_GROUPS,
  MARBLE_HAND_ORIENTATIONS,
  marbleHandTuning,
  normalizeMarbleHandInput,
  type MarbleHandControl,
  type MarbleHandTuning,
} from './marbleHandTuning'
import './marbleHandTweaks.css'

interface MarbleHandTweaksProps {
  tuning: MarbleHandTuning
  onChange: (next: MarbleHandTuning) => void
  ready: boolean
  unavailable: boolean
  parked: boolean
  onParked: (next: boolean) => void
  previewPressed: boolean
  onPreviewPressed: (next: boolean) => void
}

function NumberControl({
  control,
  value,
  onChange,
}: {
  control: MarbleHandControl
  value: number
  onChange: (next: number) => void
}) {
  // A short-lived draft lets a number field contain '-' or an empty string
  // while editing. Only finite numbers reach the live renderer; blur restores
  // an incomplete draft. Reset remains tied to the parent's actual value.
  const [draft, setDraft] = useState<string | null>(null)
  const factor = control.degrees ? 180 / Math.PI : 1
  const decimals = control.step.toString().split('.')[1]?.length ?? 0
  const displayed = value * factor
  const fieldId = `mh-control-${control.key}`
  const unit = control.degrees ? '°' : control.unit
  const commit = (next: number) => {
    const normalized = normalizeMarbleHandInput(control, next)
    if (normalized !== null) onChange(normalized)
  }

  return (
    <div className="mh-tweak-control">
      <div className="mh-tweak-control-heading">
        <label htmlFor={fieldId}>{control.label}</label>
        <div className="mh-tweak-value">
          <input
            type="number"
            aria-label={`${control.label} value`}
            data-tuning-key={control.key}
            min={control.min}
            max={control.max}
            step={control.step}
            value={draft ?? displayed.toFixed(decimals)}
            onFocus={() => setDraft(displayed.toFixed(decimals))}
            onChange={(event) => {
              setDraft(event.target.value)
              const next = event.target.valueAsNumber
              if (next >= control.min && next <= control.max) commit(next)
            }}
            onBlur={(event) => {
              if (event.target.value !== displayed.toFixed(decimals)) commit(event.target.valueAsNumber)
              setDraft(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
            }}
          />
          {unit ? <span aria-hidden="true">{unit}</span> : null}
        </div>
      </div>
      <input
        id={fieldId}
        type="range"
        data-tuning-key={control.key}
        min={control.min}
        max={control.max}
        step={control.step}
        value={displayed}
        onChange={(event) => commit(event.target.valueAsNumber)}
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="mh-tweak-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <label className="mh-tweak-color">
      <span>{label}</span>
      <code>{value.toUpperCase()}</code>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export function MarbleHandTweaks({
  tuning,
  onChange,
  ready,
  unavailable,
  parked,
  onParked,
  previewPressed,
  onPreviewPressed,
}: MarbleHandTweaksProps) {
  const [open, setOpen] = useState(true)
  const [status, setStatus] = useState('')
  const opener = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!open) opener.current?.focus()
  }, [open])

  const update = (next: MarbleHandTuning) => {
    setStatus('')
    onChange(next)
  }
  const reset = () => {
    onChange({ ...marbleHandTuning })
    onPreviewPressed(false)
    setStatus('Defaults restored.')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ marbleHand: tuning }, null, 2))
      setStatus('Settings copied. Angles use radians in JSON.')
    } catch {
      setStatus('Copy is unavailable in this browser.')
    }
  }

  if (!open) {
    return (
      <div data-marble-hand-controls>
        <button
          ref={opener}
          type="button"
          className="mh-tweaks-opener"
          aria-expanded="false"
          aria-controls="mh-controls-panel"
          onClick={() => { setOpen(true); onParked(true) }}
        >
          Tweak hand <span aria-hidden="true">↗</span>
        </button>
      </div>
    )
  }

  return (
    <aside
      id="mh-controls-panel"
      className="mh-controls"
      aria-label="Hand controls"
      data-marble-hand-controls
    >
      <header className="mh-controls-header">
        <div>
          <span className="mh-controls-eyebrow">Sculpture study</span>
          <h2>Hand controls</h2>
        </div>
        <button
          type="button"
          className="mh-controls-close"
          aria-label="Close hand controls"
          onClick={() => { setOpen(false); onParked(false); onPreviewPressed(false) }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="mh-controls-scroll">
        {!ready ? (
          <p className="mh-controls-notice" role="status">
            {unavailable
              ? 'The 3D preview is unavailable. Reload to try again. The native page still works.'
              : 'The hand is loading. The native page and browser pointer are ready.'}
          </p>
        ) : null}
        <fieldset disabled={!ready} className="mh-controls-fields">
          <legend className="mh-tweak-sr-only">Live hand settings</legend>
          <div className="mh-material-mode" role="group" aria-label="Hand material">
            <button
              type="button"
              data-hand-material="marble"
              aria-pressed={tuning.materialMode === 'marble'}
              onClick={() => update({ ...tuning, materialMode: 'marble' })}
            >
              <span className="mh-finish-swatch mh-finish-marble" aria-hidden="true" /> Marble
            </button>
            <button
              type="button"
              data-hand-material="chrome"
              aria-pressed={tuning.materialMode === 'chrome'}
              onClick={() => update({ ...tuning, materialMode: 'chrome' })}
            >
              <span className="mh-finish-swatch mh-finish-chrome" aria-hidden="true" /> Chrome
            </button>
          </div>
          <div className="mh-preview-controls">
            <Toggle label="Park hand" checked={parked} onChange={onParked} />
            <Toggle label="Hold press" checked={previewPressed} onChange={onPreviewPressed} />
            <p>{parked ? 'A still preview while you tune. Uncheck to follow the pointer.' : 'Move over the page to try the pointer. Park it to tune in place.'}</p>
          </div>

          {MARBLE_HAND_GROUPS.map((group) => {
            if (group.material && group.material !== tuning.materialMode) return null
            return (
            <details className="mh-tweak-group" key={group.title} open={group.initiallyOpen}>
              <summary>{group.title}</summary>
              <div className="mh-tweak-group-body">
                <p className="mh-tweak-help">{group.description}</p>
                {group.title === 'Orientation' ? (
                  <div className="mh-pose-presets" aria-label="Orientation presets">
                    {MARBLE_HAND_ORIENTATIONS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        data-hand-preset={preset.id}
                        aria-pressed={
                          Math.abs(tuning.baseRotation - preset.baseRotation) < 0.00001 &&
                          Math.abs(tuning.sculptureRoll - preset.sculptureRoll) < 0.00001 &&
                          Math.abs(tuning.sculpturePitch - preset.sculpturePitch) < 0.00001
                        }
                        onClick={() => {
                          update({ ...tuning, baseRotation: preset.baseRotation, sculptureRoll: preset.sculptureRoll, sculpturePitch: preset.sculpturePitch })
                          onParked(true)
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {group.title === 'Size & height' ? (
                  <Toggle label="Keep above page" checked={tuning.keepAbovePage} onChange={(keepAbovePage) => update({ ...tuning, keepAbovePage })} />
                ) : null}
                {group.title === 'Movement' ? (
                  <Toggle label="Motion rocking" checked={tuning.motionEnabled} onChange={(motionEnabled) => update({ ...tuning, motionEnabled })} />
                ) : null}
                {group.title === 'Marble' ? (
                  <div className="mh-tweak-colors">
                    <ColorControl label="Stone color" value={tuning.stoneColor} onChange={(stoneColor) => update({ ...tuning, stoneColor })} />
                    <ColorControl label="Vein color" value={tuning.veinColor} onChange={(veinColor) => update({ ...tuning, veinColor })} />
                  </div>
                ) : null}
                {group.title === 'Chrome' ? (
                  <ColorControl label="Chrome tint" value={tuning.chromeTint} onChange={(chromeTint) => update({ ...tuning, chromeTint })} />
                ) : null}
                {group.title === 'Lighting' ? (
                  <ColorControl label="Light color" value={tuning.lightColor} onChange={(lightColor) => update({ ...tuning, lightColor })} />
                ) : null}
                {group.title === 'Shadows' ? (
                  <>
                    <Toggle label="Cast shadows" checked={tuning.shadowsEnabled} onChange={(shadowsEnabled) => update({ ...tuning, shadowsEnabled })} />
                    <label className="mh-tweak-select">
                      <span>Shadow resolution</span>
                      <select value={tuning.shadowMapSize} onChange={(event) => update({ ...tuning, shadowMapSize: Number(event.target.value) })}>
                        <option value={512}>512 · fast</option>
                        <option value={1024}>1024</option>
                        <option value={2048}>2048 · balanced</option>
                        <option value={4096}>4096 · fine</option>
                      </select>
                    </label>
                  </>
                ) : null}
                {group.controls.map((control) => (
                  <NumberControl
                    key={control.key}
                    control={control}
                    value={tuning[control.key]}
                    onChange={(value) => update({ ...tuning, [control.key]: value })}
                  />
                ))}
              </div>
            </details>
            )
          })}
        </fieldset>
      </div>

      <footer className="mh-controls-footer">
        <div className="mh-controls-actions">
          <button type="button" onClick={reset} disabled={!ready}>Reset all</button>
          <button type="button" onClick={() => { void copy() }}>Copy settings</button>
        </div>
        <p className="mh-controls-status" role="status">{status || 'Changes are live. Reset restores the original study.'}</p>
      </footer>
    </aside>
  )
}
