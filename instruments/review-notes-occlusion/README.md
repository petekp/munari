# review-notes-occlusion

Local probe: a mesh in front of a Surface keeps a real click off the HTML
behind it (decisions.md #78). `npm run probe:review-notes-occlusion`.

The review notes scene wraps two live notes around a teapot on a turntable.
The probe picks a point on Mara's textarea that the scene geometry says the
spout covers with the wheel at −132° and nothing covers at −116° and −124°.
It clicks that point with a real mouse at each angle. A covered click must
leave the textarea unfocused, and a clear click must focus it. The fault
check gives the covering mesh a no-op `raycast` at −132°, and the same click
must then focus the note. Turning the wheel afterwards fails if a stale
pointer replay left R3F hovering the note.

It runs html-in-canvas and snapDOM in turn (`ENGINE` picks one) and checks
that the engine asked for is the one in use. The snapDOM run launches Chrome
without the `CanvasDrawElement` flag, so it also covers the no-flag path. It also prints the cost of the
test: each mesh's plain raycast, the note's hit region, a CPU profile over 400
moves, and paired frame-interval blocks with the teapot body's raycast on and
off. Headless Chrome paces frames at 60 Hz, so those blocks cannot show a
120 Hz budget. Results go to the evidence directory as `results.json`.
