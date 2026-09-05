// The focus hand-back — where keyboard focus lands after a window lands.
//
// Shared by the minimize and restore branches of Genie.tsx's
// `handKeyboardOver`, and pinned in `genieFocus.test.ts`. Lives here rather
// than in `Genie.tsx` so the gate is a contract a test can pin without
// mounting the scene (which pulls in the WebGL canvas and the lab's `@/`
// alias), and so a revert to the identity-only check is a failing
// assertion rather than a silent asymmetry.

/**
 * Should a restore claim the keyboard hand-back? Only when the keyboard
 * asked.
 *
 * The dock tile is the one click target in this scene that neither carries
 * `onMouseDown={noFocus}` (as the lamps do) nor is `preventDefault`-ed by the
 * gesture rig, so Chrome focuses it on mousedown — and by the time
 * `clickRestore` reads `document.activeElement`, the tile already holds
 * focus. The identity check alone (`active === slot`) cannot tell that mouse
 * focus apart from a keyboard activation, so a mouse restore would also
 * claim and the `wantsFocus` effect would move focus onto the live minimize
 * lamp on landing — putting Space/Enter one press from re-minimizing the
 * just-restored window, the exact harm the restore branch's stated intent
 * ("a mouse restore leaves focus on the wrapper ... no ring, nothing to
 * read") said it was avoiding.
 *
 * `:focus-visible` is the browser's own answer to "was this a keyboard's
 * doing", the same gate the minimize branch uses; a mouse-clicked tile does
 * not match it, so only a keyboard restore claims.
 *
 * @param active - `document.activeElement` at the moment the restore began.
 * @param slot - the dock tile the restore was triggered from.
 */
export function shouldClaimRestoreFocus(
  active: Element | null,
  slot: HTMLElement | null,
): boolean {
  return active?.matches(':focus-visible') === true && active === slot
}
