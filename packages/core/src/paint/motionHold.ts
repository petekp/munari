// Motion hold — stopping the clocks a frozen capture cannot follow.
//
// The law: while a canvas holds a Surface's content, that content's
// declarative motion stands still, and it resumes where it stopped.
//
// A capture is one instant. A source that is not `live` shows that instant
// for as long as the canvas has the content, while the content itself keeps
// moving — so the lift steps backwards by however long the capture took, and
// the return jumps forward by however long the canvas held it. Measured
// 2026-09-13: an `infinite linear` dash animation in captured content ran
// -44.5 to -50.0 of a 100-unit period across the 260ms after a lift, never
// stopping (decisions.md #66).
//
// Declarative motion only. CSS animations, CSS transitions and Web
// Animations are the ones the platform can hold and resume EXACTLY —
// `pause()` keeps the timeline where it is and `play()` takes it from there,
// which is the difference between continuing and jumping. A consumer's own
// requestAnimationFrame loop and a playing <video> have no such handle, and
// stopping either is not a capture engine's business.
//
// Core owns the primitive; the binding owns which roots a crossing covers
// and when (`live` content is never held — it asked for the motion).

/**
 * Stop every animation now running in `root`'s subtree. Returns exactly the
 * ones stopped, which is what `releaseMotion` needs: one the consumer had
 * already paused was never in the list, and must not be started by a resume.
 */
export function holdMotion(root: HTMLElement): Animation[] {
  // Absent under a DOM stub (happy-dom, where the conformance suite runs),
  // checked the same way the raster carry checks for a blitter.
  if (!('getAnimations' in root)) return []
  const held = root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running')
  for (const animation of held) animation.pause()
  return held
}

/**
 * Let a hold go. Only what is still paused resumes — `play()` on one that
 * finished or was cancelled meanwhile would start it over, which is the
 * jump this whole module exists to prevent.
 */
export function releaseMotion(held: readonly Animation[]): void {
  for (const animation of held) if (animation.playState === 'paused') animation.play()
}

/**
 * Put a copy's declarative motion where the original's is.
 *
 * A cloned subtree's CSS animations start over from zero — measured
 * 2026-09-13 as a page copy coming back at `currentTime` 8 ms while the
 * content it stood in for was held at 1917 ms. Whatever the copy is FOR, it
 * is standing in for the original's pixels, so it has to be at the
 * original's pose, and if the original is held the copy is held with it.
 *
 * Both trees must be structural clones, which is what lets element-local
 * animation lists line up by index. Call it AFTER inserting the copy: a
 * disconnected element has no animations to place.
 */
export function matchMotion(from: HTMLElement, to: HTMLElement): void {
  if (!('getAnimations' in from)) return
  const originals: Element[] = [from, ...from.querySelectorAll('*')]
  const copies: Element[] = [to, ...to.querySelectorAll('*')]
  for (const [index, original] of originals.entries()) {
    const copy = copies[index]
    if (!copy) return
    const sources = original.getAnimations()
    if (sources.length === 0) continue
    const targets = copy.getAnimations()
    for (const [slot, source] of sources.entries()) {
      const target = targets[slot]
      if (!target) continue
      target.currentTime = source.currentTime
      if (source.playState === 'paused') target.pause()
    }
  }
}
