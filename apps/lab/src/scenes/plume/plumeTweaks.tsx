// Plume controls — native settings kept outside the writing surface.
//
// The law: opening this panel is optional; mounting it never takes focus
// from the text. The 2026-08-30 study kept four effects, text actions, and
// help around the page, which competed with its disappearing typography.
// Ownership: Plume owns the text, tuning, and effects. This panel owns
// disclosure, input drafts, and the keyboard focus that disclosure moves.

import { useLayoutEffect, useRef, useState } from 'react'
import {
  PLUME_GROUPS,
  normalizePlumeInput,
  type PlumeColorControl,
  type PlumeControl,
  type PlumeEffects,
  type PlumeTuning,
} from './plumeTuning'
import './plumeTweaks.css'

interface PlumeTweaksProps {
  readonly tuning: PlumeTuning
  readonly onTuningChange: (next: PlumeTuning) => void
  readonly onReset: () => void
  readonly effects: PlumeEffects
  readonly onToggle: (key: keyof PlumeEffects) => void
  readonly onRestore: () => void
  readonly onClear: () => void
  readonly supported: boolean
  readonly reduced: boolean
  readonly animating: boolean
}

const EFFECTS: readonly {
  readonly key: keyof PlumeEffects
  readonly label: string
  readonly detail: string
}[] = [
  { key: 'wisps', label: 'Updraft', detail: 'lift particles in curling air' },
  { key: 'afterglow', label: 'Ghost ink', detail: 'leave a faint impression' },
  { key: 'embers', label: 'Sparks', detail: 'catch a few warm particles' },
  { key: 'draft', label: 'Draft', detail: 'let the pointer bend the air' },
]

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function NumberControl({
  control,
  value,
  onChange,
}: {
  readonly control: PlumeControl
  readonly value: number
  readonly onChange: (next: number) => void
}) {
  // A draft keeps '-' and an empty field editable without publishing NaN.
  // Blur either commits a bounded, snapped value or restores the live one.
  const [draft, setDraft] = useState<string | null>(null)
  const factor = control.displayScale ?? 1
  const displayStep = Number((control.step * factor).toPrecision(12))
  const decimals = displayStep.toString().split('.')[1]?.length ?? 0
  const displayed = value * factor
  const fieldId = `plume-tuning-${control.key}`
  const commit = (next: number) => {
    const normalized = normalizePlumeInput(control, next / factor)
    if (normalized !== null && normalized !== value) onChange(normalized)
  }

  return (
    <div className="plume-tweak-control">
      <div className="plume-tweak-control-heading">
        <label htmlFor={fieldId}>{control.label}</label>
        <div className="plume-tweak-value">
          <input
            type="number"
            aria-label={`${control.label} value`}
            data-tuning-key={control.key}
            data-plume-number={control.key}
            min={control.min * factor}
            max={control.max * factor}
            step={displayStep}
            value={draft ?? displayed.toFixed(decimals)}
            onFocus={() => setDraft(displayed.toFixed(decimals))}
            onChange={(event) => {
              setDraft(event.target.value)
              const next = event.target.valueAsNumber
              if (next >= control.min * factor && next <= control.max * factor) commit(next)
            }}
            onBlur={(event) => {
              commit(event.currentTarget.valueAsNumber)
              setDraft(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          {control.unit ? <span aria-hidden="true">{control.unit}</span> : null}
        </div>
      </div>
      <input
        id={fieldId}
        type="range"
        data-tuning-key={control.key}
        data-plume-range={control.key}
        min={control.min * factor}
        max={control.max * factor}
        step={displayStep}
        value={displayed}
        onChange={(event) => commit(event.target.valueAsNumber)}
      />
    </div>
  )
}

function ColorControl({
  control,
  value,
  onChange,
}: {
  readonly control: PlumeColorControl
  readonly value: string
  readonly onChange: (next: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div className="plume-tweak-color">
      <label htmlFor={`plume-color-${control.key}`}>{control.label}</label>
      <input
        type="text"
        className="plume-tweak-hex"
        aria-label={`${control.label} hex`}
        data-plume-color-hex={control.key}
        value={draft ?? value.toUpperCase()}
        maxLength={7}
        spellCheck={false}
        onFocus={() => setDraft(value.toUpperCase())}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (HEX_COLOR.test(next)) onChange(next.toLowerCase())
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <input
        id={`plume-color-${control.key}`}
        type="color"
        aria-label={`${control.label} color`}
        data-tuning-key={control.key}
        data-plume-color={control.key}
        value={value}
        onChange={(event) => {
          setDraft(null)
          onChange(event.target.value)
        }}
      />
    </div>
  )
}

export function PlumeTweaks({
  tuning,
  onTuningChange,
  onReset,
  effects,
  onToggle,
  onRestore,
  onClear,
  supported,
  reduced,
  animating,
}: PlumeTweaksProps) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const opener = useRef<HTMLButtonElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useLayoutEffect(() => {
    if (open) closer.current?.focus()
    else if (wasOpen.current) opener.current?.focus()
    wasOpen.current = open
  }, [open])

  function update<Key extends keyof PlumeTuning>(key: Key, value: PlumeTuning[Key]) {
    setFeedback('')
    onTuningChange({ ...tuning, [key]: value })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ plume: { ...tuning, effects } }, null, 2))
      setFeedback('Settings copied.')
    } catch {
      setFeedback('Copy is unavailable in this browser.')
    }
  }

  const status = !supported
    ? 'HTML-in-canvas is unavailable. The text uses a quiet dissolve.'
    : reduced
      ? 'Reduced motion is on. Ink dissolves in place.'
      : animating
        ? 'Ink is in the air.'
        : 'Ready for your next word.'

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="plume-tweaks-opener"
        data-plume-controls-opener
        hidden={open}
        aria-expanded={open}
        aria-controls="plume-controls-panel"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 5h12M2 11h12M6 3v4m4 2v4" />
        </svg>
        Tweak Plume
      </button>

      <aside
        id="plume-controls-panel"
        className="plume-controls"
        data-plume-controls
        hidden={!open}
        aria-labelledby="plume-controls-title"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }}
      >
        <header className="plume-controls-header">
          <h2 id="plume-controls-title">Plume controls</h2>
          <button
            ref={closer}
            type="button"
            className="plume-controls-close"
            data-plume-controls-close
            aria-label="Close Plume controls"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div className="plume-controls-body">
          <div className="plume-actions">
            <button type="button" data-plume-restore onClick={onRestore}>Restore text</button>
            <button type="button" data-plume-clear onClick={onClear}>Clear</button>
          </div>

          <p id="plume-note" className="plume-controls-help">
            Words stay editable after they fade. Type, timing, and spacing edits replay them.
            Other edits apply live, or replay when idle.
          </p>

          <fieldset className="plume-effects">
            <legend>Effects</legend>
            {EFFECTS.map((effect) => (
              <label key={effect.key} className="plume-effect">
                <input
                  type="checkbox"
                  checked={effects[effect.key]}
                  onChange={() => {
                    setFeedback('')
                    onToggle(effect.key)
                  }}
                />
                <span>
                  <strong>{effect.label}</strong>
                  <small>{effect.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="plume-tweak-groups">
            {PLUME_GROUPS.map((group) => (
              <details key={group.key} className="plume-tweak-group">
                <summary>
                  <span>{group.title}</span>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="m5 6 3 3 3-3" />
                  </svg>
                </summary>
                <div className="plume-tweak-group-body">
                  <p className="plume-tweak-description">{group.description}</p>
                  {group.key === 'type' ? (
                    <label className="plume-tweak-select">
                      <span>Typeface</span>
                      <select
                        value={tuning.fontFamily}
                        data-tuning-key="fontFamily"
                        data-plume-font
                        onChange={(event) => {
                          const value = event.target.value
                          if (value === 'serif' || value === 'sans' || value === 'mono') {
                            update('fontFamily', value)
                          }
                        }}
                      >
                        <option value="serif">Bodoni Moda · Serif</option>
                        <option value="sans">Archivo · Sans serif</option>
                        <option value="mono">Courier Prime · Mono</option>
                      </select>
                    </label>
                  ) : null}
                  {group.key === 'type' && tuning.fontFamily === 'mono' ? (
                    <p className="plume-tweak-description">Courier Prime has regular and bold weights.</p>
                  ) : null}
                  {group.key === 'timing' ? (
                    <label className="plume-tweak-select">
                      <span>Release unit</span>
                      <select
                        value={tuning.releaseUnit}
                        data-tuning-key="releaseUnit"
                        data-plume-release-unit
                        onChange={(event) => {
                          const value = event.target.value
                          if (value === 'word' || value === 'character') update('releaseUnit', value)
                        }}
                      >
                        <option value="word">Whole words</option>
                        <option value="character">Single characters</option>
                      </select>
                    </label>
                  ) : null}
                  {group.colors?.map((control) => (
                    <ColorControl
                      key={control.key}
                      control={control}
                      value={tuning[control.key]}
                      onChange={(value) => update(control.key, value)}
                    />
                  ))}
                  {group.controls.map((control) => (
                    <NumberControl
                      key={control.key}
                      control={control}
                      value={tuning[control.key]}
                      onChange={(value) => update(control.key, value)}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>

          <p className="plume-status" role="status">{status}</p>
        </div>

        <footer className="plume-controls-footer">
          <div className="plume-settings-actions">
            <button
              type="button"
              data-plume-reset
              onClick={() => {
                onReset()
                setFeedback('Defaults restored. Your text is unchanged.')
              }}
            >
              Reset all
            </button>
            <button type="button" data-plume-copy onClick={copy}>Copy settings</button>
          </div>
          {feedback ? <p className="plume-controls-feedback" role="status">{feedback}</p> : null}
        </footer>
      </aside>
    </>
  )
}
