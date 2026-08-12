// The knobs scene's tweak panel — a DOM overlay, deliberately OUTSIDE
// the Canvas and the captured Surface, for the reason GenieTweaks.tsx
// carries in full: a tuning surface has to be the one thing in the
// frame you can trust, so measurement infrastructure stays out of the
// custody excursion. Sliders write into knobsTuning and apply live;
// React state here is only the panel's own chrome.
//
// It anchors top-LEFT where Genie's anchors right: the slab owns the
// right rail, and a tuning surface must not stand on the pixels it is
// tuning.

import { useCallback, useState } from 'react'
import {
  KNOBS_TUNING_GROUPS,
  applyKnobsTuning,
  bumpTuningRev,
  dumpKnobsTuning,
  knobsTuning,
  type KnobsTuningDef,
} from './knobsTuning'

function Row({ knob }: { knob: KnobsTuningDef }) {
  // Seeded from the live bag, so the panel shows the truth even when
  // the console has been poking the same values.
  const [value, setValue] = useState(() => knobsTuning[knob.key])

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value)
      setValue(v)
      knobsTuning[knob.key] = v
      applyKnobsTuning()
      // Geometry knobs can't be dripped — vertex counts change — so
      // they announce a re-machine.
      if (knob.rebuild) bumpTuningRev()
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
        {value.toFixed(knob.step >= 1 ? 0 : 2)}
      </span>
    </label>
  )
}

function Group({ title, knobs }: { title: string; knobs: KnobsTuningDef[] }) {
  const [open, setOpen] = useState(true)
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
            <Row key={k.key} knob={k} />
          ))}
        </div>
      )}
    </div>
  )
}

export function KnobsTweakPanel() {
  const [open, setOpen] = useState(false)

  // A tuning session is worth nothing if it cannot leave the browser:
  // paste-ready values for baking back into the constants and the
  // var() defaults they mirror.
  const dump = useCallback(() => {
    const out = dumpKnobsTuning()
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-[200] rounded border border-white/15 bg-black/70 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/75 backdrop-blur hover:text-white"
      >
        tweaks
      </button>
    )
  }

  return (
    <div className="fixed left-4 top-4 z-[200] max-h-[calc(100vh-2rem)] w-[300px] overflow-y-auto rounded border border-white/15 bg-black/80 px-3 py-2 text-white backdrop-blur">
      <div className="flex items-center justify-between pb-1">
        <span className="text-[10px] uppercase tracking-wider text-white/50">knobs tweaks</span>
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
      {KNOBS_TUNING_GROUPS.map((g) => (
        <Group key={g.title} title={g.title} knobs={g.knobs} />
      ))}
    </div>
  )
}
