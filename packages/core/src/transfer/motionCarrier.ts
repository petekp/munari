// The motion carrier — the source of truth that lets motion cross.
//
// The crossing law parks compositor-clocked motion: a CSS animation's
// clock lives inside the compositor, neither renderer can sample it at
// the swap frame, and the only state both sides can agree on
// indefinitely is zero. So the authoring contract asks idle motion to
// ease flat, and the settle dwell waits for it.
//
// A carried motion escapes that rule the way a pointer drag always has:
// its source of truth lives OUTSIDE both renderers. One carrier owns
// one clock and one program; the page writes the carrier's sample to a
// style, the mesh applies the same sample to its transform, and the two
// outputs agree in every frame because they are one animation wearing
// two costumes. A crossing then needs no settle for this motion —
// every frame is a plateau — and the swap lands mid-flight with
// position and velocity intact (decisions.md #30).
//
// The law is small and it is a discipline, not a formula:
//
// - ONE EVALUATION PER FRAME. `tick` evaluates the program once and
//   caches; `sample` only reads the cache. However many outputs read a
//   carrier in one frame — six letters, their six meshes — they read
//   the same number. Two evaluations at two times inside one frame is
//   exactly the two-clocks fault this exists to remove.
// - THE CLOCK IS THE CALLER'S. `tick` takes an absolute timestamp
//   (a rAF timestamp in practice) and the carrier's epoch is its first
//   tick — a motion begins at its own birth, not at page load. The law
//   holds no clock of its own, so a contract can drive it with plain
//   numbers.
// - SAMPLING NEVER ADVANCES. A reader is a reader; only the driver
//   moves time. Before the first tick, `sample` is the birth value,
//   `program(0)`.
//
// What the carrier costs is honest and belongs to the consumer: the
// motion rides the main thread (the binding's rAF), giving up the
// compositor thread's immunity to jank. That trade is why carrying is
// a declaration, never a default.

export interface MotionCarrier<T> {
  /** Advance to an absolute timestamp and evaluate the program once.
   *  The first tick fixes the carrier's epoch. Returns the new sample. */
  tick(nowMs: number): T
  /** This frame's value. Reading never evaluates and never advances —
   *  every reader in a frame sees the tick's number. */
  sample(): T
}

export function createMotionCarrier<T>(program: (tMs: number) => T): MotionCarrier<T> {
  let epoch: number | null = null
  let value = program(0)
  return {
    tick(nowMs: number): T {
      if (epoch === null) epoch = nowMs
      value = program(nowMs - epoch)
      return value
    },
    sample(): T {
      return value
    },
  }
}
