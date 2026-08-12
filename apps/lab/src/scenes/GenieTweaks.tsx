// The genie scene's tweak panel — a DOM overlay, deliberately OUTSIDE
// the windows and their flights, for the same reason GlassTweaks.tsx
// states in full: a tuning surface has to be the one thing in the frame
// you can trust, so measurement infrastructure stays out of the custody
// excursion. Sliders write into genieKnobs and apply live; React state
// here is only the panel's own chrome.

import { useCallback, useState } from 'react'
import {
  GENIE_KNOB_GROUPS,
  applyGenieKnobs,
  dumpGenieKnobs,
  genieKnobs,
  type GenieKnobDef,
} from './genieKnobs'

function Row({ knob }: { knob: GenieKnobDef }) {
  // Seeded from the live bag, so the panel shows the truth even when the
  // console has been poking the same values.
  const [value, setValue] = useState(() => genieKnobs[knob.key])

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value)
      setValue(v)
      genieKnobs[knob.key] = v
      applyGenieKnobs()
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

function Group({ title, knobs }: { title: string; knobs: GenieKnobDef[] }) {
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

export function GenieTweakPanel() {
  const [open, setOpen] = useState(false)

  // A tuning session is worth nothing if it cannot leave the browser:
  // paste-ready knob values plus the two derived CSS lines (end scale
  // and easing) that genie.css carries as literals.
  const dump = useCallback(() => {
    const out = dumpGenieKnobs()
    // eslint-disable-next-line no-console
    console.log(out)
    void navigator.clipboard?.writeText(out).catch(() => {})
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 top-4 z-[200] rounded border border-white/15 bg-black/70 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/75 backdrop-blur hover:text-white"
      >
        tweaks
      </button>
    )
  }

  return (
    <div className="fixed right-4 top-4 z-[200] max-h-[calc(100vh-2rem)] w-[300px] overflow-y-auto rounded border border-white/15 bg-black/80 px-3 py-2 text-white backdrop-blur">
      <div className="flex items-center justify-between pb-1">
        <span className="text-[10px] uppercase tracking-wider text-white/50">genie tweaks</span>
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
      {GENIE_KNOB_GROUPS.map((g) => (
        <Group key={g.title} title={g.title} knobs={g.knobs} />
      ))}
    </div>
  )
}
