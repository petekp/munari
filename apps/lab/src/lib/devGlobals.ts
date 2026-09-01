// Every handle the lab hangs on `window`, in one place.
//
// These are diagnostic only: instruments read them, the console pokes at
// them, and nothing in the library ever looks. They are DECLARED here rather
// than asserted at each write site because a probe script and the scene that
// feeds it have to agree on the shape, and an assertion at the write site is
// a promise only that one write can keep. When a handle changes shape, this
// file is the diff a probe author reads.
//
// The loosely typed ones say `unknown` on purpose: their contents are console
// affordances that get rearranged constantly, and pinning them here would
// turn every experiment into a two-file edit. The precise ones are the two an
// instrument actually parses.
//
// `__glassInk` is missing on purpose — it is declared inside `glassSdf.tsx`,
// which is welded byte-for-byte to its registry twin.

import type { FisheyeProbeApi } from '../scenes/fisheye/Fisheye'
import type { SliderProbeApi } from '../scenes/slider/Slider'
import type { KnobsResizeProbeApi } from '../scenes/knobs/Knobs'
import type { GenieFilmProbeEvent } from '../scenes/genie/Genie'
import type { LogoProbeApi } from '../scenes/logo/Logo'
import type { MarbleBackgroundProbe } from '../scenes/marble-hand/marbleHandBackground'

/**
 * The demand probe's record. An instrument reads the real paint ledger and
 * framebuffer, and drives the scene through `mutate`/`resize` without a
 * pointer.
 */
export interface DemandProbeRecord {
  ready: boolean
  mutate: () => void
  resize: (next: number) => void
  readSource: () => number
  readPaints: () => number
  readSourceWidth: () => number
}

/** One line of the veil gate's dev log: what a single frame saw. */
export interface VeilGateEntry {
  /** ms since navigation, to a tenth. */
  t: number
  pw: number
  ph: number
  liveW: number
  liveH: number
  cw: number
  ch: number
  matched: boolean
  gate: number
  muGate: number | 'no-mat'
}

declare global {
  interface Window {
    /** Library-wide paint counters, for the idle-zero gate. */
    __munari?: unknown
    /** r3f's own store, so automation can walk the scene graph. */
    __r3f?: unknown
    __explode?: unknown
    __flight?: unknown
    __glass?: unknown
    __workspace?: unknown
    __workspaceHud?: unknown
    __domSurfaceDemand?: DemandProbeRecord
    __veilGateLog?: VeilGateEntry[]
    /** The knobs resize probe: a snapshot an instrument parses. */
    __knobsResizeProbe?: KnobsResizeProbeApi
    /** Installed by a watcher: every step of the film's handoff, in order. */
    __genieFilmProbe?: (event: GenieFilmProbeEvent) => void
    /** The logo scene's knob driver, for the shader gate's material walk. */
    __logo?: LogoProbeApi
    /** The fisheye scene's lens state and click ledger, for the pointer gate. */
    __fisheye?: FisheyeProbeApi
    /** The slider scene's lens and drag state, for the drag gate. */
    __slider?: SliderProbeApi
    /** The marble hand's page-canvas field: what it drew, and from when. */
    __marbleBackground?: MarbleBackgroundProbe
  }
}
