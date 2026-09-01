// Tweak panel — the lab's one schema-driven scene-tuning panel.
//
// The law: opening or closing the panel never steals focus from whatever
// the scene is doing, and every value a reviewer dials in can leave the
// browser as a pasteable TypeScript literal. The fault this replaces,
// dated 2026-09-01: three scenes (plume, marble-hand, lamp) hand-rolled
// near-identical disclosure, slider, and color-field markup with no way to
// export a dialed-in setting, so a good pose or palette lived only in one
// browser tab until someone transcribed it by hand.
//
// Ownership: this module owns the panel shell, field rendering, the
// clipboard snippet, and localStorage persistence. Each scene's
// `*Tuning.ts` still owns its defaults, ranges, and per-field
// normalization; each scene's `*Tweaks.tsx` owns turning that schema into
// this panel's props and any content bespoke enough to not be a field
// (presets, mode switches, effect toggles).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './tweakPanel.css'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Every field a tuning bag can hold — the three scenes' bags are entirely
 * numbers, strings (enums, hex colors), and booleans. */
export type TweakValue = string | number | boolean
export type TweakBag = Readonly<Record<string, TweakValue>>

export interface TweakControl {
  readonly id: string
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit?: string
  readonly value: number
  readonly onChange: (next: number) => void
  readonly numberAttrs?: Readonly<Record<string, string>>
  readonly rangeAttrs?: Readonly<Record<string, string>>
}

export interface TweakGroup {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly initiallyOpen?: boolean
  /** Bespoke content (presets, selects, color and toggle fields) rendered
   * between the description and the plain number controls. */
  readonly extra?: ReactNode
  readonly controls: readonly TweakControl[]
}

export interface TweakPanelProps<T extends object> {
  readonly title: string
  /** Small label above the title (e.g. "Sculpture study"). */
  readonly eyebrow?: string
  /** Unique per scene; seeds element ids and the localStorage key. */
  readonly idPrefix: string
  readonly groups: readonly TweakGroup[]
  readonly tuning: T
  readonly onReset: () => void
  readonly storageKey: string
  /** Turns a stored bag — shaped like T but not necessarily valid at
   * runtime (an older build, a hand-edited entry) — into a complete,
   * in-range tuning object. Never throws; falls back field-by-field. */
  readonly normalizeTuning: (raw: T) => T
  readonly onApplyStored: (restored: T) => void
  readonly initiallyOpen?: boolean
  readonly className?: string
  readonly position?: 'top-right' | 'bottom-right'
  readonly openerLabel: ReactNode
  readonly openerAttrs?: Readonly<Record<string, string>>
  readonly rootAttrs?: Readonly<Record<string, string>>
  readonly closeAriaLabel: string
  readonly closerAttrs?: Readonly<Record<string, string>>
  readonly resetAttrs?: Readonly<Record<string, string>>
  readonly resetDisabled?: boolean
  readonly copyAttrs?: Readonly<Record<string, string>>
  /** Rendered in the body above the (optionally disabled) fieldset — a
   * scene notice or a control block that must stay enabled either way. */
  readonly beforeFieldset?: ReactNode
  readonly fieldsetDisabled?: boolean
  /** Rendered inside the fieldset, above the groups. */
  readonly children?: ReactNode
  /** Rendered inside the fieldset, below the groups. */
  readonly afterGroups?: ReactNode
  /** Shown in the footer when no copy/reset feedback is active. */
  readonly footerHint?: ReactNode
  readonly onOpenChange?: (open: boolean) => void
}

export function serializeTweakValues<T extends object>(values: T): string {
  const lines = Object.entries(values).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
  return `{\n${lines.join('\n')}\n}`
}

/** The slice of the Storage API persistence needs — small enough to fake
 * in a test without jsdom. */
export interface TweakStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// A stored entry from an older build can carry fields an updated scene no
// longer has, or values outside a since-narrowed range. normalizeTuning
// (scene-owned) is what turns that raw JSON back into something safe to
// apply; a read that fails before reaching it (bad JSON, disabled storage)
// returns null and leaves the scene's shipped defaults live.
export function readStoredTuning<T extends object>(
  storage: TweakStorage,
  storageKey: string,
  normalizeTuning: (raw: T) => T,
): T | null {
  try {
    const raw = storage.getItem(storageKey)
    if (raw == null) return null
    // SAFETY: this cast claims only the shape stored JSON *should* have.
    // normalizeTuning re-validates every field at runtime (numeric range,
    // enum membership, hex pattern) before trusting any of it, so an older
    // build's entry or one hand-edited in devtools still can't reach the
    // scene as anything but a fully valid, in-range tuning object.
    const parsed = JSON.parse(raw) as T
    return normalizeTuning(parsed)
  } catch {
    return null
  }
}

export function writeStoredTuning<T extends object>(storage: TweakStorage, storageKey: string, tuning: T): void {
  try {
    storage.setItem(storageKey, JSON.stringify(tuning))
  } catch {
    // Storage full, disabled, or unavailable (private browsing); the
    // panel stays fully usable without persistence.
  }
}

export function clearStoredTuning(storage: TweakStorage, storageKey: string): void {
  try {
    storage.removeItem(storageKey)
  } catch {
    // Nothing to clear if storage was never reachable.
  }
}

export function TweakPanel<T extends object>({
  title,
  eyebrow,
  idPrefix,
  groups,
  tuning,
  onReset,
  storageKey,
  normalizeTuning,
  onApplyStored,
  initiallyOpen = false,
  className,
  position = 'top-right',
  openerLabel,
  openerAttrs,
  rootAttrs,
  closeAriaLabel,
  closerAttrs,
  resetAttrs,
  resetDisabled = false,
  copyAttrs,
  beforeFieldset,
  fieldsetDisabled = false,
  children,
  afterGroups,
  footerHint,
  onOpenChange,
}: TweakPanelProps<T>) {
  const [open, setOpen] = useState(initiallyOpen)
  const [feedback, setFeedback] = useState<'' | 'copied' | 'reset'>('')
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const firstRun = useRef(true)
  const feedbackTimeout = useRef<number | undefined>(undefined)
  const didMount = useRef(false)

  // Focus follows disclosure, but never on the render that mounts the
  // panel — a scene that opens with `initiallyOpen` must not steal focus
  // from the page the moment it loads.
  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (open) closer.current?.focus()
    else opener.current?.focus()
  }, [open])

  // Restore once, before the first paint the user can edit.
  useEffect(() => {
    const restored = readStoredTuning(window.localStorage, storageKey, normalizeTuning)
    if (restored) onApplyStored(restored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every live edit is saved, but not the very first render's defaults —
  // that would immediately overwrite a value just restored above.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }
    writeStoredTuning(window.localStorage, storageKey, tuning)
  }, [tuning, storageKey])

  function setOpenState(next: boolean) {
    setOpen(next)
    onOpenChange?.(next)
  }

  function flash(kind: 'copied' | 'reset') {
    setFeedback(kind)
    window.clearTimeout(feedbackTimeout.current)
    feedbackTimeout.current = window.setTimeout(() => setFeedback(''), 1500)
  }

  async function handleCopy() {
    const snippet = serializeTweakValues(tuning)
    try {
      await navigator.clipboard.writeText(snippet)
      setCopyFallback(null)
      flash('copied')
    } catch {
      setCopyFallback(snippet)
    }
  }

  function handleReset() {
    clearStoredTuning(window.localStorage, storageKey)
    onReset()
    setCopyFallback(null)
    flash('reset')
  }

  const panelId = `${idPrefix}-tweak-panel`
  const titleId = `${idPrefix}-tweak-panel-title`
  const positionClass = position === 'bottom-right' ? 'tweak-panel--bottom-right' : 'tweak-panel--top-right'
  const themeClass = [positionClass, className].filter(Boolean).join(' ')

  return (
    <>
      <button
        ref={opener}
        type="button"
        className={['tweak-opener', themeClass].filter(Boolean).join(' ')}
        hidden={open}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenState(true)}
        {...openerAttrs}
      >
        {openerLabel}
      </button>

      <aside
        id={panelId}
        className={['tweak-panel', themeClass].filter(Boolean).join(' ')}
        hidden={!open}
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setOpenState(false)
        }}
        {...rootAttrs}
      >
        <header className="tweak-panel-header">
          <div>
            {eyebrow ? <span className="tweak-panel-eyebrow">{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            ref={closer}
            type="button"
            className="tweak-panel-close"
            aria-label={closeAriaLabel}
            onClick={() => setOpenState(false)}
            {...closerAttrs}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div className="tweak-panel-body">
          {beforeFieldset}
          <fieldset disabled={fieldsetDisabled} className="tweak-panel-fields">
            <legend className="tweak-sr-only">{title} settings</legend>
            {children}
            <div className="tweak-panel-groups">
              {groups.map((group) => (
                <TweakGroupDisclosure key={group.key} group={group} />
              ))}
            </div>
            {afterGroups}
          </fieldset>
        </div>

        <footer className="tweak-panel-footer">
          <div className="tweak-panel-actions">
            <button type="button" onClick={handleReset} disabled={resetDisabled} {...resetAttrs}>Reset all</button>
            <button type="button" onClick={() => { void handleCopy() }} data-tweak-copy="" {...copyAttrs}>Copy values</button>
          </div>
          {feedback === 'copied' ? (
            <p className="tweak-panel-feedback" role="status">Copied</p>
          ) : feedback === 'reset' ? (
            <p className="tweak-panel-feedback" role="status">Defaults restored.</p>
          ) : footerHint ? (
            <p className="tweak-panel-feedback" role="status">{footerHint}</p>
          ) : null}
          {copyFallback ? (
            <div className="tweak-panel-copy-fallback">
              <p>Clipboard access is unavailable here. Copy manually:</p>
              <textarea
                readOnly
                value={copyFallback}
                aria-label={`${title} values`}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          ) : null}
        </footer>
      </aside>
    </>
  )
}

function TweakGroupDisclosure({ group }: { readonly group: TweakGroup }) {
  return (
    <details className="tweak-group" open={group.initiallyOpen}>
      <summary>
        <span>{group.title}</span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m5 6 3 3 3-3" />
        </svg>
      </summary>
      <div className="tweak-group-body">
        <p className="tweak-group-description">{group.description}</p>
        {group.extra}
        {group.controls.map((control) => (
          <TweakNumberField key={control.id} {...control} />
        ))}
      </div>
    </details>
  )
}

export function TweakNumberField({ id, label, min, max, step, unit, value, onChange, numberAttrs, rangeAttrs }: TweakControl) {
  // A draft keeps '-' and an empty field editable without publishing NaN.
  // Blur either commits a bounded, snapped value or restores the live one.
  const [draft, setDraft] = useState<string | null>(null)
  const decimals = step.toString().split('.')[1]?.length ?? 0
  const fieldId = `tweak-${id}`
  const commit = (next: number) => onChange(next)

  return (
    <div className="tweak-control">
      <div className="tweak-control-heading">
        <label htmlFor={fieldId}>{label}</label>
        <div className="tweak-value">
          <input
            type="number"
            aria-label={`${label} value`}
            min={min}
            max={max}
            step={step}
            value={draft ?? value.toFixed(decimals)}
            onFocus={() => setDraft(value.toFixed(decimals))}
            onChange={(event) => {
              setDraft(event.target.value)
              const next = event.target.valueAsNumber
              if (next >= min && next <= max) commit(next)
            }}
            onBlur={(event) => {
              commit(event.currentTarget.valueAsNumber)
              setDraft(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            {...numberAttrs}
          />
          {unit ? <span aria-hidden="true">{unit}</span> : null}
        </div>
      </div>
      <input
        id={fieldId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => commit(event.target.valueAsNumber)}
        {...rangeAttrs}
      />
    </div>
  )
}

export interface TweakColorFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (next: string) => void
  readonly swatchAttrs?: Readonly<Record<string, string>>
  readonly hexAttrs?: Readonly<Record<string, string>>
}

export function TweakColorField({ id, label, value, onChange, swatchAttrs, hexAttrs }: TweakColorFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const fieldId = `tweak-color-${id}`

  return (
    <div className="tweak-color">
      <label htmlFor={fieldId}>{label}</label>
      <input
        type="text"
        className="tweak-hex"
        aria-label={`${label} hex`}
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
        {...hexAttrs}
      />
      <input
        id={fieldId}
        type="color"
        aria-label={`${label} color`}
        value={value}
        onChange={(event) => {
          setDraft(null)
          onChange(event.target.value)
        }}
        {...swatchAttrs}
      />
    </div>
  )
}

export interface TweakToggleFieldProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  readonly attrs?: Readonly<Record<string, string>>
}

export function TweakToggleField({ label, checked, onChange, attrs }: TweakToggleFieldProps) {
  return (
    <label className="tweak-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} {...attrs} />
      <span>{label}</span>
    </label>
  )
}
