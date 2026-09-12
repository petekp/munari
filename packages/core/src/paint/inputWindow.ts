// Input window — when a mutation counts as the user's doing.
//
// A capture that does not follow content moving on its own must still
// follow what the user did to it: a field re-rendering as it is typed in,
// a menu opening on a click, a thumb following a drag. The user's mutation
// and an animation's look the same. They are told apart by WHEN they land:
// the user's input opens a window, and a mutation inside it is the answer.
//
// The fault this shape answers, measured 2026-09-12 (Safari 18.6, a desk of
// ten idle Surfaces at dpr 2, interleaved blocks, medians of three):
// following every mutation through the 150 ms capture gap left 15% of idle
// frames over 20 ms at 8.3 captures/s. Following nothing brought that to 2%
// and 0.0 captures/s, and lost the input echo — a lifted counter's DOM read
// 2 while its texture still showed 1. Following the user only measured 1%
// and 0.0, and kept the echo.
//
// Two consumers judge by this one law so they cannot drift: the rasterized
// source judges its own element's mutations, and element capture judges a
// native element's mutations before rebuilding its copy. What each captures
// regardless — a resize, a font or image landing, a transition's end,
// anything that would leave the picture WRONG rather than old — is its own.

/**
 * How long after the user's input a mutation still counts as its answer.
 *
 * Why this number: an input's DOM consequence lands in the same task (a
 * discrete React commit runs before the event returns) or a frame or two
 * after it (a passive effect, a batched continuous update). 150 ms covers
 * both with room, and equals the rasterized source's capture gap, so a
 * mutation the pacer would have coalesced into the input's own capture is
 * never the one refused (decisions.md #60, 2026-09-12 amendment).
 */
export const INPUT_WINDOW_MS = 150

/**
 * Events that say the user is acting on a subtree.
 *
 * The key events are here although by themselves they change nothing a
 * capture could show, because a keystroke is exactly the input whose
 * answer, a field re-rendering, has to be seen. So is a native HTML5 drag:
 * both engines' browsers stop the pointer stream at `dragstart` (measured
 * 2026-09-12: Chrome fires `pointercancel` there and no `pointerup`; Safari
 * 18.6 fires neither until a `pointerup` at the drop), so a drop target
 * lighting up lands on `dragenter`/`dragleave` and the reorder a drop makes
 * on `drop`/`dragend`, with no pointer event near either. A bare
 * `pointermove` is NOT here: hovering over content is not
 * acting on it, and the relay forwards a move on every frame the pointer
 * rests on a Surface, which would keep a self-animating subtree followed
 * for as long as it is under the pointer. A pointer drag's moves count
 * through the gesture its press begins (`hear`).
 */
export const INPUT_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointerover',
  'pointerout',
  'keydown',
  'keyup',
  'input',
  'change',
  'focusin',
  'focusout',
  'scroll',
  'dragstart',
  'dragenter',
  'dragleave',
  'drop',
  'dragend',
] as const

export interface HearOptions {
  /**
   * Input to disown: a whole-page root contains other captures' parked
   * copies and canvases, whose input is the user acting on a different
   * Surface, not on this content.
   */
  ignore?: (target: EventTarget | null) => boolean
}

export interface InputWindow {
  /** Whether a mutation landing now counts as the user's doing. */
  isOpen: () => boolean
  /**
   * Hear the user's input on `root`: every `INPUT_EVENTS` member, and the
   * gesture a press begins until that same pointer lifts, a native drag
   * takes over, or the window loses focus. Returns the unlisten.
   */
  hear: (root: HTMLElement, options?: HearOptions) => () => void
}

/** `now` is injected so a suite can advance time instead of waiting for it. */
export function createInputWindow(now: () => number): InputWindow {
  let until = -Infinity
  const open = () => {
    until = now() + INPUT_WINDOW_MS
  }
  const hear = (root: HTMLElement, { ignore }: HearOptions = {}) => {
    const hearing = new AbortController()
    const heard = (event: Event) => {
      if (!ignore?.(event.target)) open()
    }
    for (const event of INPUT_EVENTS) {
      root.addEventListener(event, heard, { capture: true, signal: hearing.signal })
    }
    // A gesture begun on the content is the user acting on it until it ends,
    // wherever the moves land. A drag handled on `window` is the common
    // shape — a slider, a resize handle, a pointer-driven drag-and-drop
    // library — and its moves never touch the subtree, so the window would
    // close 150 ms into the drag and the thumb would freeze under the hand.
    root.addEventListener(
      'pointerdown',
      (press: PointerEvent) => {
        if (ignore?.(press.target)) return
        const gesture = new AbortController()
        const options = { capture: true, signal: gesture.signal }
        const document = root.ownerDocument
        // The pressing pointer's own events, so a second finger lifting
        // does not end the first finger's drag.
        const own = (event: PointerEvent, run: () => void) => {
          if (event.pointerId === press.pointerId) run()
        }
        const end = () => {
          open()
          gesture.abort()
        }
        document.addEventListener('pointermove', (e) => own(e, open), options)
        document.addEventListener('pointerup', (e) => own(e, end), options)
        document.addEventListener('pointercancel', (e) => own(e, end), options)
        // Two ends the pointer stream may never report: a native drag
        // begins (Chrome cancels the pointer there; Safari goes silent until
        // the drop) and the window loses focus (the release lands on another
        // window). Without these the gesture's listeners outlive the gesture.
        document.addEventListener('dragstart', end, options)
        document.defaultView?.addEventListener('blur', end, options)
        hearing.signal.addEventListener('abort', end, { signal: gesture.signal })
      },
      { capture: true, signal: hearing.signal },
    )
    return () => {
      hearing.abort()
    }
  }
  return { isOpen: () => now() < until, hear }
}
