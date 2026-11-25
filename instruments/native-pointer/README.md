# native-pointer

Local gate: the native pointer route (decisions.md #39), driven for the
through the library. `npm run gate:native-pointer`.

One exclusive Surface opts into `pointerRoute="auto"` in the gl phase.
The gate's discriminator is `isTrusted`: the relay's synthetic dispatch
can never set it, so a source-copy click record with `trusted: true` is
proof the browser itself delivered the pointer through the rig.

The judged clauses: a rest click and a default-route gl click are the
liveness baselines (native page hit, then the synthetic relay); asking
for `'auto'` on a flat pose dresses the parked canvas exactly as
`nativeRoute.ts` says (matrix3d from `transform-origin: 0 0`,
`visibility: hidden`, z lifted, drawn root visible); a trusted click at
the projected button reaches the real element; real `:hover` engages
and the `data-hover` twin follows it on and off; a click focuses the
real input and typed keys land in it; a 30°/12° tilt moves the
projected box and still takes the trusted click; and returning the
request to `'relay'` restores every written style and the relay hears
again. Clicks aim at the content's own `getBoundingClientRect()` —
under the worn pose the browser's rects ARE the projection (platform.md
#19: 0.01px), so no gate-side matrix math can drift from the rig.

A box mesh stands in front of the button, sized to 60 × 30 CSS px at nine
tenths of the camera's distance to the Surface (decisions.md #78). Covered, a
relayed click reaches the content 0 times in `pointerMode="surfaces"` and in
`pointerMode="scene"`, and uncovered it reaches it once in each. On the native
route, a move onto the covered point must park the rig and the click must not
reach the content. A touch tap with no move before it, onto a point covered
while the rig rides, must not reach the content either. Uncovered again, a
trusted native click reaches the button.

The input is controlled above the Surface. After typing through the native
canvas route, the gate returns to the page, verifies the value, edits it there,
and re-enters the canvas. The same retained element must contain the edited value.

What it deliberately does not judge: the OS cursor. Whether Chrome
applies an unpainted canvas child's `cursor` is #39's open question and
no API reads the pointer's actual glyph, so the gate prints where the
hit-test landed and the answer needs `HEADED=1` and an eye on the
target. The pose-hold paint economy (0 paints/frame, platform.md #21)
is pinned by the cover-clip spike and not re-measured here.
