// @vitest-environment happy-dom
//
// The restore focus hand-back, pinned at its one decision point.
//
// `shouldClaimRestoreFocus` is the gate between a mouse restore and a
// keyboard restore: only the latter may claim the keyboard hand-back, so
// the `wantsFocus` effect moves focus onto the live minimize lamp ONLY when
// the keyboard asked. A mouse-clicked dock tile does NOT match
// `:focus-visible` (Chrome focuses the tile on mousedown — it has no
// `noFocus` defense, unlike the lamps — but that mousedown focus is not a
// keyboard activation), so it must not claim and focus stays on the inert
// wrapper; a single Space/Enter on the wrapper then does nothing, instead of
// re-minimizing the just-restored window.
//
// `:focus-visible` is a browser focus policy this scene cannot evaluate in
// happy-dom (no layout, no focus heuristics), so the cases below stub
// `matches` per element to stand in for the browser's verdict. The faithful
// behaviour proof lives in the degraded/lab browser gates (see the test
// plan, Tier 2); this is the logic-pinning regression guard that runs in
// every CI `checks` job and makes a revert to the identity-only check
// (`active === slot`) a failing assertion rather than a silent asymmetry.
//
// No JSX here: the runner only discovers `.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldClaimRestoreFocus } from './genieFocus'

// A fixture mirroring the desk's structure: the inert wrapper (`.gen-slot`,
// `tabIndex={-1}`, programmatic focus only), the dock tile (`.gen-tile`,
// the restore click target that has no `noFocus` defense), and the live
// minimize lamp (`.gen-lamp[data-role="minimize"]`, the `onClick` a
// subsequent Space/Enter would fire).
const fixture = () => {
  document.body.innerHTML = ''
  const wrapper = document.createElement('div')
  wrapper.className = 'gen-slot'
  wrapper.tabIndex = -1
  wrapper.dataset.win = 'quadrato'
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = 'gen-tile'
  tile.dataset.role = 'window'
  tile.dataset.filled = 'true'
  tile.dataset.win = 'quadrato'
  const lamp = document.createElement('button')
  lamp.type = 'button'
  lamp.className = 'gen-lamp'
  lamp.dataset.role = 'minimize'
  document.body.append(wrapper, tile, lamp)
  return { wrapper, tile, lamp }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shouldClaimRestoreFocus — the gate the restore branch claims through', () => {
  it('a keyboard-driven tile matches :focus-visible and CLAIMS the hand-back', () => {
    const { tile } = fixture()
    // The browser's verdict for a keyboard activation (Tab+Enter on the
    // filled dock tile): :focus-visible matches.
    const matches = vi.spyOn(tile, 'matches').mockReturnValue(true)
    expect(shouldClaimRestoreFocus(tile, tile)).toBe(true)
    expect(matches).toHaveBeenCalledWith(':focus-visible')
  })

  it('a mouse-clicked tile does NOT match :focus-visible and does not claim', () => {
    const { tile } = fixture()
    // Chrome focuses a <button> on mousedown, so `active === slot` is true
    // for a mouse click too — the identity check alone could not tell the
    // two apart. The browser's :focus-visible verdict is the separator: a
    // mouse-clicked tile does not match it.
    vi.spyOn(tile, 'matches').mockReturnValue(false)
    expect(shouldClaimRestoreFocus(tile, tile)).toBe(false)
  })

  it('an unrecognised active element does not claim even when it matches :focus-visible', () => {
    // The identity half of the gate: focus elsewhere (e.g. the wrapper, or
    // another window's tile) must not let THIS window claim the hand-back.
    const { tile, wrapper } = fixture()
    vi.spyOn(wrapper, 'matches').mockReturnValue(true)
    expect(shouldClaimRestoreFocus(wrapper, tile)).toBe(false)
  })

  it('a null active element does not claim', () => {
    const { tile } = fixture()
    expect(shouldClaimRestoreFocus(null, tile)).toBe(false)
  })

  it('a null slot does not claim even for a keyboard-driven active element', () => {
    const { tile } = fixture()
    vi.spyOn(tile, 'matches').mockReturnValue(true)
    expect(shouldClaimRestoreFocus(tile, null)).toBe(false)
  })
})

describe('the restore-branch outcome driven by the real predicate', () => {
  // The branch and the `wantsFocus` effect re-wired here use the REAL
  // predicate as their only decision, so a revert of the gate flips the
  // outcome below. The effect behaviour (focus the lamp iff claimed) is the
  // documented contract from Genie.tsx; the lamp is live, so a Space/Enter
  // on it would minimise — and a Space/Enter on the inert wrapper does not.

  const restore = (active: Element, slot: HTMLElement) => {
    // handKeyboardOver — restore branch, shedding the wrapper.focus() side
    // effect (irrelevant to the claim decision under test).
    const wantsFocus = new Set<string>()
    if (shouldClaimRestoreFocus(active, slot)) wantsFocus.add('quadrato')
    return wantsFocus
  }

  it('mouse restore: nothing is claimed, the effect does NOT move focus to the lamp', () => {
    const { wrapper, tile, lamp } = fixture()
    vi.spyOn(tile, 'matches').mockReturnValue(false) // mouse: no :focus-visible
    const wantsFocus = restore(tile, tile)
    // The `wantsFocus` effect on landing focuses the lamp only for a claimed
    // id. The bug (identity-only gate) would have claimed here, moving focus
    // onto the live lamp — one Space/Enter from re-minimizing. The fix leaves
    // focus on the inert wrapper. The downstream Space→minimize hazard is a
    // browser-gate concern (happy-dom does not activate buttons on keydown);
    // the contract this test pins is the focus destination itself.
    expect(wantsFocus.has('quadrato')).toBe(false)
    const focusLamp = vi.spyOn(lamp, 'focus')
    if (wantsFocus.has('quadrato')) lamp.focus()
    expect(focusLamp).not.toHaveBeenCalled()
    // A keypress on the wrapper does not reach the lamp's click handler.
    let minimized = false
    lamp.addEventListener('click', () => {
      minimized = true
    })
    wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(minimized).toBe(false)
  })

  it('keyboard restore: the claim is set, and the effect moves focus to the live minimize lamp', () => {
    const { tile, lamp } = fixture()
    vi.spyOn(tile, 'matches').mockReturnValue(true) // keyboard: :focus-visible
    const wantsFocus = restore(tile, tile)
    // The keyboard user gets the hand-back: focus moves onto the lamp so the
    // window's first tabbable control is where the next key lands.
    expect(wantsFocus.has('quadrato')).toBe(true)
    const focusLamp = vi.spyOn(lamp, 'focus')
    if (wantsFocus.has('quadrato')) lamp.focus()
    expect(focusLamp).toHaveBeenCalledTimes(1)
  })
})
