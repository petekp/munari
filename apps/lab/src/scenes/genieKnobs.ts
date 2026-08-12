// The genie scene's tuning surface — the values a hand wants to drag
// while judging the marks, and the machinery that applies them live.
//
// Two kinds of application, because the scene has two kinds of number:
//
//   CSS custom properties. Stroke and opacity are read by genie.css
//   through var() with defaults equal to the committed values, so an
//   untouched panel changes nothing and the stylesheet stays the
//   single source of truth for what ships.
//
//   Live reads. Speed and size belong to the bounce simulation
//   (genieBounce.ts), which reads this bag on every frame — no push,
//   no CSSOM, nothing to desynchronise.
//
// Writes go straight into live objects; nothing re-renders the scene
// (the GlassTweaks doctrine).

export interface GenieKnobValues {
  /** Cruising speed of every mark, px/s. */
  markSpeed: number
  /** Multiplies each mark's drawn size. */
  markScale: number
  /** Multiplies each mark's collision silhouette, on top of markScale.
   *  1 = the silhouette IS the drawn figure (the triangle collides on
   *  its slants, not on a box); smaller lets figures overlap before
   *  bouncing, larger keeps them apart. */
  markBounds: number
  /** Stroke weight, px on screen. */
  markStroke: number
  /** One opacity for every mark. */
  markOpacity: number
  /** Flight loop radius, px. Signed: the side the circle sits on. */
  loopRadius: number
}

export const genieKnobs: GenieKnobValues = {
  markSpeed: 32,
  markScale: 1.55,
  markBounds: 1,
  markStroke: 1.75,
  markOpacity: 0.55,
  loopRadius: 52,
}

/** Push every knob into the live page. Cheap enough to call per input. */
export function applyGenieKnobs(k: GenieKnobValues = genieKnobs): void {
  const root = document.documentElement.style
  root.setProperty('--gen-mark-stroke', `${k.markStroke}px`)
  root.setProperty('--gen-mark-opacity', String(k.markOpacity))
  // markSpeed, markScale, and markBounds are read live by the
  // simulation each frame.
}

/** The paste-ready record of a tuning session. */
export function dumpGenieKnobs(): string {
  return JSON.stringify({ genieKnobs }, null, 2)
}

export interface GenieKnobDef {
  key: keyof GenieKnobValues
  label: string
  min: number
  max: number
  step: number
}

export const GENIE_KNOB_GROUPS: { title: string; knobs: GenieKnobDef[] }[] = [
  {
    title: 'marks',
    knobs: [
      { key: 'markSpeed', label: 'speed px/s', min: 4, max: 120, step: 2 },
      { key: 'markScale', label: 'size', min: 0.5, max: 2, step: 0.05 },
      { key: 'markBounds', label: 'bounds', min: 0.5, max: 2, step: 0.05 },
      { key: 'markStroke', label: 'stroke px', min: 0.5, max: 4, step: 0.25 },
      { key: 'markOpacity', label: 'opacity', min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'flight',
    knobs: [{ key: 'loopRadius', label: 'loop radius', min: -120, max: 120, step: 2 }],
  },
]
