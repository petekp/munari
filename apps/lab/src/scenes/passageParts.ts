// The passage, second design — the pure half.
//
// The first version ran the layout engine at every intermediate width and
// rendered whatever came back. That is the most honest thing a browser can be
// asked to do and it looks terrible, for three reasons that are all the same
// reason:
//
//   - 120 real reflows means the text re-wraps 120 times. A word does not
//     move from the end of one line to the start of the next; it VANISHES
//     from one and APPEARS on the other, every frame, all over the card.
//   - the card passes through container-query regimes neither endpoint has.
//     Measured on this component: about 170 ms of a two-column layout that
//     exists only in transit.
//   - type sizes sweep continuously (16 → 39.48 px) through every value no
//     designer ever chose.
//
// So the layout engine now answers TWICE — once at each endpoint — and what
// happens in between is a flight. Every part of the card is measured in both
// answers and matched by identity, and the parts travel. Nothing re-wraps,
// because nothing re-lays-out; a word that changes line simply moves there.
//
// That last sentence is the thing no DOM-based tool can do, and the reason is
// structural rather than incidental: a line box is not an element. There is no
// node for "line 3 of this paragraph", so there is nothing for a layout
// animation to hold, and the best any of them can do is cross-fade the whole
// paragraph. We are not animating the DOM. We are flying its pixels, using its
// own layout — at both ends — as the ground truth.
//
// This file is the correspondence law: given two measured layouts, who goes
// where. It is pure so it can be tested without a browser, and because the
// interesting mistakes here are all arithmetic.

/** A rectangle in card-local CSS px, origin at the card's top-left corner. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * What a part is.
 *
 * `word` is a run of characters with one `Range` around it — the granularity
 * the whole idea depends on. `block` is an element that paints something of
 * its own (a background, a border): those cannot be split into words and do
 * not want to be, because a stretched background IS what a resized background
 * looks like.
 */
export type PartKind = 'word' | 'block'

export interface Part {
  /**
   * Stable across layouts: the same content in both measurements gets the
   * same key. Derived from tree position rather than from text, because both
   * layouts are measured from the SAME markup — so the nth word of the mth
   * text node is the same word, whatever width it was laid out at, and
   * whatever line it landed on.
   */
  key: string
  kind: PartKind
  box: Box
  /** Reading order within the layout this part was measured in. */
  order: number
}

export interface Layout {
  width: number
  height: number
  parts: readonly Part[]
}

/**
 * One part's whole flight, ready to become instance attributes.
 *
 * `uvFrom`/`uvTo` are the part's box normalised by the size of the endpoint it
 * was measured in — so a quad carries a window onto each endpoint's texture
 * and samples the SAME word out of both. That is what makes the cross-fade
 * invisible: a fade is only ugly when the two things being blended are in
 * different places, and here they are in the same place by construction,
 * because the quad is at that place.
 */
export interface FlightPart {
  key: string
  kind: PartKind
  from: Box
  to: Box
  uvFrom: Box
  uvTo: Box
  /** 1 when the part was really measured on that side, 0 when synthesised. */
  hasFrom: 0 | 1
  hasTo: 0 | 1
  /** Where in the flight this part's own fade sits, 0…1. */
  delay: number
  /**
   * 1 when the line break moved across this word between the two layouts.
   *
   * Zero for almost everything. One for the handful of words that change line
   * — and those are the only ones that fly through their neighbours' text.
   */
  crossing: 0 | 1
}

/**
 * How far a part that exists at only one end travels on its own account.
 *
 * Content that has no counterpart cannot cross-fade with itself, so it has to
 * arrive some other way, and a fade alone reads as a dissolve — the exact
 * mush this design exists to beat. A small rise gives it a direction. Small
 * is the point: this is a local move inside a card that is itself flying
 * across the screen, and anything bigger competes with that.
 */
export const RISE = 14

/**
 * The stagger window for content that arrives or leaves, as a fraction of the
 * flight.
 *
 * Arrivals are pushed into the back half: the card has to have grown into a
 * shape that has room for them before they mean anything. Departures run
 * early for the same reason in reverse. `SPREAD` is how much of the flight
 * separates the first arrival from the last — enough that the eye reads a
 * sweep in reading order rather than a simultaneous pop, short enough that
 * the last word is not still landing after everything else has settled.
 */
export const ARRIVE_AT = 0.42
export const SPREAD = 0.34
/** How long any one part's own fade takes. */
export const FADE = 0.22

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

/** A box normalised into 0…1 texture coordinates of an endpoint that size. */
export function uvOf(b: Box, width: number, height: number): Box {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return box(b.x / w, b.y / h, b.w / w, b.h / h)
}

/** Just the size of a card — the frame a part's box is expressed in. */
export interface Frame {
  width: number
  height: number
}

/**
 * The same box, expressed in another card's frame.
 *
 * A part's box is in card-local px, so it only means anything alongside the
 * card it was measured in. Carrying it into the other frame proportionally is
 * what "the same place on the card" means when the card is a different size.
 */
export function carriedInto(b: Box, of: Frame, into: Frame): Box {
  const sx = into.width / Math.max(1, of.width)
  const sy = into.height / Math.max(1, of.height)
  return box(b.x * sx, b.y * sy, b.w * sx, b.h * sy)
}

/**
 * Where a part that only exists at the destination comes FROM.
 *
 * It borrows the card's own transform: its destination box, carried back into
 * the source card's frame, dropped by `RISE`. That is the only honest answer
 * available — the part has no history, so it gets the history of the thing
 * carrying it — and it is the correction that made the arrivals stop looking
 * like a separate effect happening near the card.
 *
 * The version this replaces put the arrival at its DESTINATION coordinates
 * from the first frame, on the theory that a word which never moves can never
 * cross anything. Measured, that theory is about a card that does not exist
 * yet: the body copy sits at y = 416 in a 695 px card, the card is 324 px tall
 * when the flight begins and about 424 px when the body starts to fade in — so
 * for two thirds of the flight those words hang in the air BELOW the panel,
 * at final size, while everything around them is still small and still
 * growing. They read as a caption that has come loose.
 *
 * Carried, they sit exactly where they will sit, on a card that is exactly as
 * big as it currently is, and they grow with it at the same rate as every
 * matched word beside them.
 */
export function arrivalSource(to: Box, of: Frame, into: Frame, rise = RISE): Box {
  const c = carriedInto(to, of, into)
  return box(c.x, c.y + rise, c.w, c.h)
}

/** And the mirror: a part with no counterpart at the destination sinks away. */
export function departureTarget(from: Box, of: Frame, into: Frame, rise = RISE): Box {
  const c = carriedInto(from, of, into)
  return box(c.x, c.y + rise, c.w, c.h)
}

/**
 * When a part's own fade runs, given its place in reading order.
 *
 * Shared parts return 0 and mean it: they are never faded in or out, they
 * cross-fade with themselves across the whole flight. Only the unmatched
 * ones get a window.
 */
export function fadeDelay(order: number, count: number, at = ARRIVE_AT, spread = SPREAD): number {
  if (count <= 1) return at
  const rel = Math.min(1, Math.max(0, order / (count - 1)))
  return at + spread * rel
}

/** Are these two boxes on the same line of text? */
export function sharesLine(a: Box, b: Box): boolean {
  return Math.abs(a.y - b.y) < 0.5 * Math.min(a.h, b.h)
}

/**
 * Did this word change LINE between the two layouts?
 *
 * Asked of the word and the one before it, in both layouts: if they were
 * together and are now apart, or apart and are now together, the break moved
 * across this word. That is the whole event.
 *
 * The version this replaces asked a plausible geometric question instead — how
 * far the word ends up from where the card's own growth would have put it,
 * in units of its own width — and it convicted the innocent. The card grows
 * 3.05× wide but only 2.15× tall (the body copy appears at the large end and
 * nothing above it scales with the card's height), so EVERY word carries a
 * large vertical residual, and dividing by the word's own size then turns
 * short words into the biggest offenders: "in" scored 6.8 against a threshold
 * of 3.5 without moving off its line at all. On screen that was the whole
 * meta line dimmed and shuffled while the one word that actually crossed sat
 * beside it looking the same.
 *
 * A predicate about lines cannot make that mistake, and it is also the honest
 * one: this scene exists because a line box is not an element. If the line a
 * word is on is the thing no DOM tool can hold, the line a word is on is the
 * thing worth detecting.
 */
export function crossedLine(prevFrom: Box, from: Box, prevTo: Box, to: Box): boolean {
  return sharesLine(prevFrom, from) !== sharesLine(prevTo, to)
}

/** The key of the word before this one in the same text node, if any. */
export function previousWord(key: string): string | null {
  const m = /^(w\d+):(\d+)$/.exec(key)
  if (!m) return null
  const j = Number(m[2])
  return j > 0 ? `${m[1]}:${j - 1}` : null
}

/**
 * Match two measured layouts and produce every part's flight.
 *
 * Three populations come out, and the interesting one is the third:
 *
 *   - matched, in both layouts — travels and cross-fades with itself
 *   - departing, only in the source — sinks and fades
 *   - arriving, only in the destination — rises and fades in
 *
 * On this card the split is 27 / 0 / 69, because the body copy is
 * `display: none` at the small end. So more than two thirds of the destination
 * is content that has to be introduced rather than moved — which is why the
 * stagger is a law here and not a flourish. A cross-fade has exactly one way
 * to introduce it: all at once, on top of whatever is leaving.
 *
 * Order is deterministic — matched parts in destination reading order, then
 * departures — so instance buffers built from this are stable across a
 * reversal and can be uploaded once per flight rather than once per frame.
 */
function crossingIn(
  source: Map<string, Part>,
  dest: Map<string, Part>,
  key: string,
  from: Box,
  to: Box,
): 0 | 1 {
  const prev = previousWord(key)
  if (!prev) return 0
  const a = source.get(prev)
  const b = dest.get(prev)
  if (!a || !b) return 0
  return crossedLine(a.box, from, b.box, to) ? 1 : 0
}

export function planFlight(from: Layout, to: Layout): FlightPart[] {
  const source = new Map(from.parts.map((p) => [p.key, p]))
  const dest = new Map(to.parts.map((p) => [p.key, p]))

  const arrivals = to.parts.filter((p) => !source.has(p.key))
  const departures = from.parts.filter((p) => !dest.has(p.key))

  const out: FlightPart[] = []

  for (const p of to.parts) {
    const a = source.get(p.key)
    if (a) {
      out.push({
        key: p.key,
        kind: p.kind,
        from: a.box,
        to: p.box,
        uvFrom: uvOf(a.box, from.width, from.height),
        uvTo: uvOf(p.box, to.width, to.height),
        hasFrom: 1,
        hasTo: 1,
        delay: 0,
        crossing: crossingIn(source, dest, p.key, a.box, p.box),
      })
    } else {
      const src = arrivalSource(p.box, to, from)
      out.push({
        key: p.key,
        kind: p.kind,
        from: src,
        to: p.box,
        // Both windows point at the endpoint that actually has the pixels.
        // The shader never samples the other texture for this part, but a UV
        // that is merely unused still has to be in range — an out-of-range
        // one costs a clamped fetch on every fragment for nothing.
        uvFrom: uvOf(p.box, to.width, to.height),
        uvTo: uvOf(p.box, to.width, to.height),
        hasFrom: 0,
        hasTo: 1,
        delay: fadeDelay(arrivals.indexOf(p), arrivals.length),
        // Carried by construction, so it crosses nothing by construction.
        crossing: 0,
      })
    }
  }

  for (const p of departures) {
    out.push({
      key: p.key,
      kind: p.kind,
      from: p.box,
      to: departureTarget(p.box, from, to),
      uvFrom: uvOf(p.box, from.width, from.height),
      uvTo: uvOf(p.box, from.width, from.height),
      hasFrom: 1,
      hasTo: 0,
      // Departures run in the front of the flight, in their own reading
      // order, and `1 - ARRIVE_AT` mirrors the arrival window about the
      // middle so that a close is an open played backwards.
      delay: fadeDelay(departures.indexOf(p), departures.length, 1 - ARRIVE_AT - SPREAD, SPREAD),
      crossing: 0,
    })
  }

  return out
}

/**
 * The part's box at progress `t`.
 *
 * A straight lerp, and deliberately so: the curve belongs to the flight, not
 * to the parts. Every part shares one progress value, which is what makes a
 * hundred quads read as one object rearranging rather than as a hundred
 * things that happen to be moving at once. The scene's spring supplies `t`,
 * so a reversal mid-flight moves the target and every part turns around
 * together, still in formation.
 */
export function boxAt(p: FlightPart, t: number): Box {
  const c = Math.min(1, Math.max(0, t))
  return box(
    p.from.x + (p.to.x - p.from.x) * c,
    p.from.y + (p.to.y - p.from.y) * c,
    p.from.w + (p.to.w - p.from.w) * c,
    p.from.h + (p.to.h - p.from.h) * c,
  )
}

/**
 * How present a part is at progress `t`, 0…1.
 *
 * Matched parts do not fade. They only move, and this is the single most
 * important line in the file: fading something that is also travelling is what
 * makes a cross-fade look like a cross-fade, and a word that stays opaque the
 * whole way reads as an object.
 *
 * The one exception is a part that is CROSSING rather than riding — see
 * `CROSS_DIP`. It is not a fade: it is a half-sine dip that is zero at both
 * endpoints and applies to the two or three words per card that fly through
 * their neighbours. It is the difference between a word being in the air and a
 * word being blended.
 *
 * Unmatched parts get a `smoothstep` over their own window. The window is
 * expressed in flight progress rather than in seconds so that it survives a
 * spring that speeds up, slows down, or turns around.
 */
export function presenceAt(p: FlightPart, t: number): number {
  if (p.hasFrom === 1 && p.hasTo === 1) return 1 - CROSS_DIP * p.crossing * crossBump(t)
  const c = Math.min(1, Math.max(0, t))
  const a = p.delay
  const b = Math.min(1, p.delay + FADE)
  const x = b <= a ? (c >= b ? 1 : 0) : Math.min(1, Math.max(0, (c - a) / (b - a)))
  const s = x * x * (3 - 2 * x)
  // A part with no destination is the same curve, read the other way.
  return p.hasTo === 1 ? s : 1 - s
}

/**
 * How far off the card's surface a crossing part flies, in card-local px, and
 * how much of its opacity it gives up while it is up there.
 *
 * The word that changes line is the one shot in this whole scene that no
 * document-based transition can even attempt, and rendered flat it was also
 * the ugliest thing on screen: it travels the width of the title, straight
 * through the line it is joining, two opaque white words occupying the same
 * pixels for a third of the flight. Both are illegible for as long as it
 * lasts, which reads as a glitch rather than as a move.
 *
 * So it leaves the surface. `CROSS_LIFT` is real z in the card's own frame, so
 * the card's bank parallaxes the word against the paragraph it is passing over
 * — it is visibly ABOVE the text rather than mixed into it — and `CROSS_DIP`
 * is the transparency that being in the air costs it. The dip is what makes
 * both words readable through the crossing; the lift is what explains the dip.
 *
 * Both ride `crossBump`, which is EXACTLY zero at both endpoints — a half-sine
 * is only zero there to sixteen digits, and a word that lands at 0.99999994 of
 * its opacity is a word that does not quite match the DOM it is handing back
 * to. Smoothstepped as well as parabolic, so it also leaves and rejoins the
 * surface with zero slope: the lift-off and the touchdown are the two moments
 * a discontinuity would show.
 */
export const CROSS_LIFT = 30
export const CROSS_DIP = 0.55

export function crossBump(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  const x = 4 * c * (1 - c)
  return x * x * (3 - 2 * x)
}

/**
 * How far through the SIZE change a part is, 0…1, measured in log size.
 *
 * Log, because it is the space in which "twice as big" and "half as big" are
 * the same distance — the only space a sharpness argument can honestly be
 * made in. At `growth` 1 this degenerates to `t`, which is correct: neither
 * texture is better, so there is no phase to talk about.
 */
export function sizePhase(t: number, growth: number): number {
  const c = Math.min(1, Math.max(0, t))
  if (!(growth > 0) || Math.abs(growth - 1) < 1e-3) return c
  return Math.min(1, Math.max(0, Math.log(1 + (growth - 1) * c) / Math.log(growth)))
}

/**
 * How wide the swap between the two captures is, in size phase.
 *
 * SHORT, and this is the correction that mattered most. The first version
 * cross-faded the two captures across the whole flight on the theory that a
 * word blending with itself is invisible. It is not, and the measurement says
 * why: the two rasterizations of one word are not the same picture scaled.
 * Across the title at these two sizes the glyph advances grow 2.315× to
 * 2.37× word by word while the type itself grows 2.47× — so at any blend
 * fraction the letters inside a word sit up to three pixels apart in the two
 * samples, and the eye reads three pixels of disagreement held for 700 ms as
 * an embossed, doubled word. That is the "glitchy" verdict, and no choice of
 * box fixes it, because the disagreement is inside the glyph run.
 *
 * A blend that is over quickly has nowhere to show that. What is on screen is
 * one rasterization or the other for almost the whole flight, and the swap is
 * a brief shimmer between two pictures that are already the same size, the
 * same place, and the same word.
 */
export const HANDOVER = 0.26

/**
 * How much of the DESTINATION texture to show, 0…1, for a matched part.
 *
 * Centred on the size phase's midpoint — the moment the quad is equally badly
 * served by both captures, in log size — so each capture is on screen exactly
 * while it is the sharper one. A word that grows hands over early in `t` and
 * a word that shrinks hands over late, both from the same line.
 */
export function handoverAt(t: number, growth: number): number {
  const s = sizePhase(t, growth)
  const lo = 0.5 - HANDOVER / 2
  const x = Math.min(1, Math.max(0, (s - lo) / HANDOVER))
  return x * x * (3 - 2 * x)
}
