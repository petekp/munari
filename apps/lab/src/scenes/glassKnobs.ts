// Scene-level knobs for the glass scene, and the schema the tweak panel
// renders from.
//
// Why a module and not React state: the values are read inside useFrame, sixty
// times a second, by code that must not re-render when they change. So this is
// one mutable object that the panel pokes and the frame loop reads — the same
// contract the glass panels' own params objects use, and the same reason. A
// slider drag would otherwise remount the scene on every pixel of travel.
//
// The GLASS parameters are deliberately NOT here. Those live on each panel's
// own live params object (sdfPanelParams) because they are per-panel, and
// duplicating them would create two sources of truth for the same number.

export type GlassSceneKnobs = {
  // ── orbs ───────────────────────────────────────────────────────────────
  orbCount: number
  /** Half-width of the crossing, world units — where orbs enter and leave. */
  orbSpan: number
  /** Seconds for the slowest orb's crossing; the ensemble's period is n×this. */
  orbCycle: number
  /** Vertical scatter of the lanes. */
  orbLane: number
  orbSize: number

  // ── what a crossing does to the sheet ──────────────────────────────────
  impactAmp: number
  /** Signed by the emitter; this is the magnitude relative to the impact. */
  exitAmp: number
  /** Neck radius at pinch-off, as a fraction of the orb. Sets how FINE the
   *  release reads — it is a spectrum knob, not a size knob. */
  exitSource: number
  wakeAmp: number
  /** World units of travel between wake fronts. */
  wakeSpacing: number

  // ── the page ───────────────────────────────────────────────────────────
  /** Peak camera displacement from the pointer, world units. 0 disables. */
  parallax: number
  /** Seconds-ish time constant for the camera easing toward the pointer. */
  parallaxEase: number

  // ── the CTA ────────────────────────────────────────────────────────────
  /** How far the button sinks toward the form on press, world units. */
  pressDepth: number
  pressStiffness: number
  pressDamping: number
  /** Radius of the liquid bulge raised under the finger. */
  pressBulge: number
  /** How much of the strike spills onto the form surface underneath. */
  spillAmp: number
  /** How much wider the spill opens than the strike that caused it. */
  spillReach: number
}

export const glassKnobs: GlassSceneKnobs = {
  orbCount: 6,
  orbSpan: 6.2,
  orbCycle: 13,
  orbLane: 1.25,
  orbSize: 1,

  impactAmp: 0.7,
  // The release is the quiet half of a crossing. Weak (0.1 against the
  // impact's 0.7) and BROAD — a neck radius two thirds of the orb, versus the
  // impact's own 0.04 — so it opens as a soft swell instead of the fine, spiky
  // train an arrival makes. A departure that rings as loudly as an arrival
  // reads as a second impact, which is the opposite of what leaving is.
  exitAmp: 0.1,
  exitSource: 0.67,
  // Held far under the events it trails. The wake is context for a crossing,
  // not an event of its own; see rippleWaveSpeed in glassSdf.tsx for the other
  // half of keeping it subsonic.
  wakeAmp: 0.05,
  wakeSpacing: 0.62,

  parallax: 0.22,
  parallaxEase: 0.12,

  pressDepth: 0.07,
  pressStiffness: 520,
  pressDamping: 26,
  // Measured against the pill's own half-height (0.17): a bulge anywhere near
  // that is a SECOND pill fused to the first, and the eye reads two shapes
  // instead of one shape reacting. Under a third of it, the outline still
  // clearly moves under the finger and stays a button the whole time.
  pressBulge: 0.05,
  spillAmp: 0.38,
  spillReach: 2.4,
}

// ── the schema the panel renders from ────────────────────────────────────
// Ranges are authored, not derived: a slider's useful span is a design fact
// (how far can this go before it stops looking like glass) and there is no way
// to infer it from a default value.

export interface Knob {
  key: string
  label: string
  min: number
  max: number
  step: number
  /** Where the value lives: the scene knobs, or a named panel's params. */
  target: 'scene' | 'card' | 'pill' | 'both'
}

export interface KnobGroup {
  title: string
  knobs: Knob[]
}

const n = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  target: Knob['target'],
): Knob => ({ key, label, min, max, step, target })

export const GLASS_KNOB_GROUPS: KnobGroup[] = [
  {
    title: 'orbs',
    knobs: [
      n('orbCount', 'count', 0, 6, 1, 'scene'),
      n('orbSpan', 'span', 2, 10, 0.1, 'scene'),
      n('orbCycle', 'cycle (s)', 4, 30, 0.5, 'scene'),
      n('orbLane', 'lane spread', 0, 3, 0.05, 'scene'),
      n('orbSize', 'size', 0.3, 2.5, 0.05, 'scene'),
    ],
  },
  {
    title: 'ripples — the crossing',
    knobs: [
      n('impactAmp', 'impact', 0, 3, 0.05, 'scene'),
      n('exitAmp', 'release', 0, 1.5, 0.05, 'scene'),
      n('exitSource', 'release fineness', 0.02, 1, 0.01, 'scene'),
      n('wakeAmp', 'wake', 0, 1, 0.01, 'scene'),
      n('wakeSpacing', 'wake spacing', 0.15, 1.5, 0.02, 'scene'),
    ],
  },
  {
    title: 'ripples — the wave law',
    knobs: [
      n('rippleAmp', 'amplitude', 0, 3, 0.05, 'both'),
      n('rippleK', 'scale K', 0.5, 12, 0.1, 'both'),
      n('rippleNu', 'viscosity', 0, 0.02, 0.0002, 'both'),
      n('rippleDecay', 'bulk decay (s)', 0.2, 4, 0.05, 'both'),
      n('rippleLife', 'life (s)', 0.4, 5, 0.1, 'both'),
      n('rippleWaveSpeed', 'wave speed c', 0.4, 6, 0.05, 'both'),
      n('rippleInk', 'drags the ink', 0, 1.5, 0.02, 'both'),
    ],
  },
  {
    title: 'glass — the card',
    knobs: [
      n('radius', 'corner', 0, 0.6, 0.005, 'card'),
      n('bezel', 'bezel', 0.01, 0.5, 0.005, 'card'),
      n('thickness', 'thickness', 0, 0.6, 0.005, 'card'),
      n('spread', 'refraction', 0, 1.2, 0.01, 'card'),
      n('ior', 'ior', 1, 2.2, 0.01, 'card'),
      n('chroma', 'dispersion', 0, 0.4, 0.005, 'card'),
      n('roughness', 'frost', 0, 1, 0.01, 'card'),
      n('tintAmount', 'tint', 0, 0.5, 0.005, 'card'),
      n('inkOpacity', 'ink', 0, 1, 0.01, 'card'),
      n('smooth', 'merge radius', 0, 0.5, 0.005, 'card'),
    ],
  },
  {
    title: 'glass — the edge',
    knobs: [
      n('edgeLight', 'piped light', 0, 2, 0.01, 'both'),
      n('edgeReflect', 'reflectivity', 0, 1, 0.01, 'both'),
      n('edgeWarp', 'organic warp', 0, 0.08, 0.001, 'both'),
      n('edgeWarpSpeed', 'warp speed', 0, 4, 0.05, 'both'),
      n('specular', 'specular', 0, 2, 0.02, 'both'),
    ],
  },
  {
    title: 'glass — the CTA',
    knobs: [
      n('radius', 'corner', 0, 0.4, 0.005, 'pill'),
      n('bezel', 'bezel', 0.01, 0.3, 0.005, 'pill'),
      n('thickness', 'thickness', 0, 0.4, 0.005, 'pill'),
      n('spread', 'refraction', 0, 1.2, 0.01, 'pill'),
      n('ior', 'ior', 1, 2.2, 0.01, 'pill'),
    ],
  },
  {
    title: 'the press',
    knobs: [
      // Capped just short of PILL_Z: past that the button sinks THROUGH the
      // form's plane, and the compositor's view-space sort would swap them.
      n('pressDepth', 'depress', 0, 0.12, 0.005, 'scene'),
      n('pressStiffness', 'spring stiffness', 80, 1200, 10, 'scene'),
      n('pressDamping', 'spring damping', 4, 80, 1, 'scene'),
      n('pressBulge', 'liquid bulge', 0, 0.4, 0.005, 'scene'),
      // Brightness and reach of the strike live on the PILL's own params —
      // they are glass parameters, and this file does not keep a second copy
      // of those.
      n('glowAmp', 'strike', 0, 5, 0.05, 'pill'),
      n('glowReach', 'strike reach', 0.05, 1, 0.01, 'pill'),
      n('spillAmp', 'spill onto form', 0, 2, 0.02, 'scene'),
      n('spillReach', 'spill width', 1, 6, 0.05, 'scene'),
    ],
  },
  {
    title: 'the page',
    knobs: [
      n('parallax', 'parallax', 0, 1, 0.01, 'scene'),
      n('parallaxEase', 'parallax ease', 0.01, 1, 0.01, 'scene'),
    ],
  },
]
