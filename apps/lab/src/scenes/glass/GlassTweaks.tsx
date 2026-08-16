// The tweak panel — a DOM overlay, deliberately OUTSIDE the canvas.
//
// It could have been built as Surface content inside the scene, which would
// have been the more impressive demo and the wrong instrument. A tuning
// surface has to be the one thing in the frame you can trust: if it refracted,
// wobbled and lagged along with everything else, then every judgement made
// with it would be a judgement about the panel plus the panel's own distortion
// of the number that set it. Measurement infrastructure stays out of the
// excursion.
//
// Everything here writes STRAIGHT into live mutable objects — scene knobs, or
// a panel's own params — and nothing re-renders the scene. React state is used
// only for the panel's own chrome (which group is open, what the slider should
// draw). That split is why a drag stays smooth at sixty frames: the scene never
// learns that a slider moved, it just reads a different number next frame.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GLASS_KNOB_GROUPS,
  glassTuning,
  type Knob,
} from './glassTuning'
import { sdfPanelParams, type GlassParams } from './glassSdf'

// Every knob addresses a number. The two strings in a panel's params (`tint`
// and `glowColor`) have no knob — the colour inputs write them directly.
type Bag = Record<string, number>
type NumericParams = Omit<GlassParams, 'tint' | 'glowColor'>

/** Every live object a knob might address, resolved at the moment of use. */
function targetsOf(target: Knob['target']): Bag[] {
  if (target === 'scene') return [glassTuning]
  const out: Bag[] = []
  if (target === 'card' || target === 'both') {
    const p: NumericParams | null = sdfPanelParams('glass-card')
    if (p) out.push(p)
  }
  if (target === 'pill' || target === 'both') {
    const p: NumericParams | null = sdfPanelParams('glass-pill')
    if (p) out.push(p)
  }
  return out
}

function readKnob(k: Knob): number {
  const [first] = targetsOf(k.target)
  return first?.[k.key] ?? 0
}

function writeKnob(k: Knob, value: number) {
  for (const bag of targetsOf(k.target)) bag[k.key] = value
}

function Row({ knob }: { knob: Knob }) {
  // Seeded from the live object rather than from a default, so the panel shows
  // the truth even when the console has been poking the same values.
  const [value, setValue] = useState(() => readKnob(knob))
  // The panels register on mount, which may be after this row first renders —
  // one late read gets the real value in without polling forever.
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    const id = requestAnimationFrame(() => {
      synced.current = true
      setValue(readKnob(knob))
    })
    return () => cancelAnimationFrame(id)
  }, [knob])

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value)
      setValue(v)
      writeKnob(knob, v)
    },
    [knob],
  )

  return (
    <label className="flex items-center gap-2 py-[3px] text-[10px] leading-none">
      <span className="w-[104px] shrink-0 truncate text-white/55">{knob.label}</span>
      <input
        type="range"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={value}
        onChange={onInput}
        className="h-[3px] flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#ff4f17]"
      />
      <span className="w-[46px] shrink-0 text-right tabular-nums text-white/80">
        {/* Steps below 0.01 are the ones where the last digit is the whole
            point of the knob, so the precision follows the step. */}
        {value.toFixed(knob.step >= 1 ? 0 : knob.step >= 0.01 ? 2 : 4)}
      </span>
    </label>
  )
}

function Group({ title, knobs }: { title: string; knobs: Knob[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-white/10 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-1.5 text-[10px] uppercase tracking-wider text-white/70 hover:text-white"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        {title}
      </button>
      {open && (
        <div className="pb-2">
          {knobs.map((k) => (
            // Keyed by target too: `radius` appears under both the card and
            // the CTA, and they are genuinely different knobs.
            <Row key={`${k.target}:${k.key}`} knob={k} />
          ))}
        </div>
      )}
    </div>
  )
}

export function GlassTweakPanel() {
  const [open, setOpen] = useState(false)

  // A tuning session is worth nothing if it cannot leave the browser. This
  // prints the current state of every knob as a paste-ready object, which is
  // how a value found by dragging becomes a value committed to the file.
  const dump = useCallback(() => {
    const scene = { ...glassTuning }
    const out = {
      glassTuning: scene,
      card: sdfPanelParams('glass-card'),
      pill: sdfPanelParams('glass-pill'),
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2))
    void navigator.clipboard?.writeText(JSON.stringify(out, null, 2)).catch(() => {})
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 top-4 z-50 rounded border border-white/15 bg-black/70 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/75 backdrop-blur hover:text-white"
      >
        tweaks
      </button>
    )
  }

  return (
    <div className="fixed right-4 top-4 z-50 max-h-[calc(100vh-2rem)] w-[300px] overflow-y-auto rounded border border-white/15 bg-black/80 px-3 py-2 text-white backdrop-blur">
      <div className="flex items-center justify-between pb-1">
        <span className="text-[10px] uppercase tracking-wider text-white/50">tweaks</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={dump}
            className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white"
          >
            copy
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>
      {GLASS_KNOB_GROUPS.map((g) => (
        <Group key={g.title} title={g.title} knobs={g.knobs} />
      ))}
    </div>
  )
}
