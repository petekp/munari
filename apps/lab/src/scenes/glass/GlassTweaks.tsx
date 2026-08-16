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
import { TuningGroup, TuningPanel, TuningSlider } from '@/components/TuningPanel'
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
    (nextValue: number) => {
      setValue(nextValue)
      writeKnob(knob, nextValue)
    },
    [knob],
  )

  return (
    <TuningSlider
      label={knob.label}
      min={knob.min}
      max={knob.max}
      step={knob.step}
      value={value}
      // Steps below 0.01 are the ones where the last digit is the whole
      // point of the knob, so the precision follows the step.
      decimalPlaces={knob.step >= 1 ? 0 : knob.step >= 0.01 ? 2 : 4}
      onValueChange={onInput}
    />
  )
}

export function GlassTweakPanel() {
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

  return (
    <TuningPanel title="tweaks" side="right" zIndex={50} onCopy={dump}>
      {GLASS_KNOB_GROUPS.map((g) => (
        <TuningGroup key={g.title} title={g.title} initialState="closed">
          {g.knobs.map((k) => (
            // Keyed by target too: `radius` appears under both the card and
            // the CTA, and they are genuinely different knobs.
            <Row key={`${k.target}:${k.key}`} knob={k} />
          ))}
        </TuningGroup>
      ))}
    </TuningPanel>
  )
}
