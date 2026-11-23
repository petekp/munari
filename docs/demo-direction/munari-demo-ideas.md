# Munari demo concepts, first list

This list proposes four demos for Munari's lab, drawn from the traits in [ui-feed-notes.md](ui-feed-notes.md). Pete picks which one to build. Nothing here is built.

Each concept follows three rules, taken from ui-feed and from the bar Munari's demos already hold:

- One object with one physical rule, and the rule is what the UI means.
- The 3D object is the thing the UI is about. The real HTML sits on it or in it and keeps its caret, focus and state.
- The concept fails if a known shortcut fakes most of it. The shortcuts are CSS 3D transforms, drei's `<Html transform occlude>` or three.js's CSS3DRenderer over a canvas, and a static texture.

## Ranking

1. Review notes that stick to a 3D model. Medium for a one-note first slice, large in full. Recommended first build.
2. A day planner you close by tearing off the page. Medium.
3. A spec sheet that cuts through the product. Large.
4. A live app on a curved device screen. Medium. The review recommended dropping it, and it stays here as the weakest option.

## 1. Review notes that stick to a 3D model

A product prototype, such as a ceramic kettle, sits on a review page beside an ordinary HTML comment thread. You write a note in the thread with text, a checkbox and an @mention. Then you drag it onto the model. As it crosses into the canvas it leaves the page and wraps onto the body where it lands, like a decal on a curve. Rotate the kettle and the notes turn with it. They take the studio light across their curve and slip partly behind the spout. Click a note on the model and keep typing there. Tick "resolved" and the note peels off the body and returns to the thread, struck through.

The rule is that a note lives where it is about, and resolving it means peeling it off.

Munari capabilities used:

- A `Surface` handed between page and scene with state kept, so the draft, the checkbox and the caret survive both trips.
- `deformSurfaceGeometry` to wrap each note onto the body once, where it lands. The notes are children of the model, so rotating it needs no new deformation. Clicks and typing land correctly on the curve because the vertices move, not only the pixels.
- `Surface.LitMaterial`, depth-tested against the model, with many Surfaces on one `SurfaceCanvas`.

A Munari user learns to attach real, editable UI to any 3D object. Uses include CAD review, digital twins, configurators and annotated scans.

The nearest shortcut is drei's `<Html transform occlude>`. It pins a flat note to the model and hides it when the model blocks it. The note cannot bend around the curve, shade across it or be partly covered. The nearest lab scene is Postcard, which hands a form to the scene and back. This concept adds wrapping onto a model and editing in place there.

Open questions:

- Text stretches on strongly curved shapes. Choose a gently curved body, and build the wrapping from the surface point and normal where the note lands.
- In Safari a handoff restarts running CSS animations.
- snapDOM paints no caret, so typing on the model shows no caret outside HTML-in-canvas.

A one-note first slice proves the whole idea. It covers drag in, wrap, rotate, type in place and resolve back.

## 2. A day planner you close by tearing off the page

A tear-off day planner shows today's tasks as real checkboxes and editable text. At the end of the day you grab the bottom corner and pull. The live page lifts and curls under your hand, and tomorrow's page shows underneath, already live, with unfinished tasks carried over in the same places. Let go before the perforation and today settles back. Pull past it and the sheet tears at the speed of your hand, curls and falls away.

The rule is that tearing a day off means it is done, and what you did not finish is already on the next page.

Munari capabilities used:

- Two live Surfaces, today on top and tomorrow beneath, so the tear can be taken back at any point before the perforation.
- `deformSurfaceGeometry` on today's Surface for the curl and the tear, with clicks still landing on the curled page.
- The same layout on both pages, so carried tasks line up exactly.

A Munari user learns to commit a state change with a gesture, with the next state visible and usable before they commit.

Without Munari, page-curl libraries such as turn.js clip and transform the live DOM. They have no real curl geometry, no tear and no fall.

The nearest lab scenes are Frontier's Peel and Flight. Peel lifts a card partway to show a second live layer, and Flight peels cards off a page. This concept adds a threshold that commits, and a next page made from the current one. That is a thin addition to a gesture the lab already has.

Open questions:

- Two full-page Surfaces in one canvas cost more to capture than one. Measure before tuning the curl.
- The torn edge needs a shader or a cut in the geometry. Neither exists in the lab yet.

## 3. A spec sheet that cuts through the product

A 3D product, such as a camera, stands on the page. Its spec sheet is a sheet of real HTML standing inside it. A clipping plane removes the outer casing on the viewer's side of the sheet. The internal parts are not clipped, so the lens elements, the sensor board and the battery cross in front of the text. Scrolling the sheet moves the sheet and the cut deeper through the body. The sensor paragraph arrives as the sheet meets the sensor board. The cut casing is capped, so the shell reads as solid.

The rule is that reading deeper cuts deeper. Scrolling becomes the control of a section view.

Munari capabilities used:

- One `Surface` whose `Surface.Mesh` uses `placement="manual"`, depth-tested so the parts that cross it hide the text behind them.
- `pointerRoute="auto"` on that mesh for native scrolling and text selection. The native route works only while the sheet faces the camera, so the orbit is limited to the front.
- The sheet's scroll position, read from the DOM, drives the clipping plane.

A Munari user learns to put real documentation inside a 3D object and drive the object from the document. Uses include product pages, repair manuals and anatomy lessons.

The nearest shortcut is CSS3DRenderer under a transparent WebGL canvas, with a depth-only plane at the sheet's pose. That lets parts hide the text correctly. It cannot let light pass between them. So the parts must shade the text: the sensor board casts a shadow on its paragraph, and the lens elements tint the lines behind them. The nearest lab scene is Beyond's X-Ray loupe, which shows a circuit board under a console. This concept puts the document inside the object.

Open questions:

- Capping the cut casing needs a stencil technique the lab does not have yet.
- The native input route does not check what covers the sheet. A click on a part in front of the text would select the hidden text, so input must relay while the pointer is over a part.
- Orbiting behind the sheet would show mirrored text and lose selection, so the camera must stay in front.
- The model needs named internal parts and a license that allows publishing.

## 4. A live app on a curved device screen

A small portable television from no particular brand sits on the page. Its bulging glass shows a real web app inside it: a music player with a timeline and a playlist. You can use the app through the curved glass. Turn the device and the studio light moves across the screen, brighter at the bulge and darker toward the edges. Press "Take it out" and the app lifts off the glass, flattens and lands as the page itself, with its playlist scroll and focus kept.

The rule is that the screen is part of the object, and the app inside it is the real one.

Munari capabilities used:

- A live `Surface` bent to the glass with `deformSurfaceGeometry`, so relayed clicks land on the right pixel of the bulge.
- `Surface.LitMaterial`, so the screen's brightness comes from the scene's lights.
- The handoff from scene to page with state kept.

A Munari user learns to put their real product inside a 3D device for landing pages and docs. It needs no video and no second build of the UI.

Without Munari, the usual mockup is a flat iframe tilted with CSS 3D, with gradients over it for glare. That gets most of the way. The curve and the lighting across it are what CSS cannot do.

The nearest lab scene is Genie, which bends a live window and returns it to the page. This concept is close to Genie run in reverse, with a device as the subject.

Open questions:

- It is a product mockup more than a new way to interact. This is why it ranks last.
- A bent Surface relays input as synthetic events, which cannot drive a native range input or start a text selection. The timeline must be a scrubber built in JavaScript.
- Whether playing audio survives the handoff is unmeasured.
- With snapDOM a Surface's `live` is ignored, so the moving timeline needs `useSurfaceRefresh()` calls outside Chrome.
- The device must be original, not a recreation of a real product.

## Scenes these concepts avoid

The concepts avoid ideas the lab already shows:

- glass lenses over a page (Crystal, Optics, Fisheye, Slider, Selection and the X-Ray loupe)
- lighting a page (Light and Lamp) and casting shadows from a live card (the Sundial prototype)
- falling words (Gravity) and text turning to particles (Plume)
- peeling and crumpling cards (Flight, Frontier's Peel and the Candidates peel)
- deleting a row (the Candidates delete study)
- folding and pleating (the dieline and concertina prototypes)
- a ring of panels around the viewer (Workspace)

## Vercel's UI SDK

UI SDK is a library of unstyled, accessible components built from reusable behaviors, such as popups, typeahead, selection and drag to reorder. A framework-free TypeScript core renders in React, Vue, Svelte, Solid and Web Components. It is aimed at coding agents. Its docs ship inside the package. An "agent bridge" lets an agent read component state and call component actions without clicking.

Its status, checked 2026-11-23:

- Source: [vercel-labs/ui](https://github.com/vercel-labs/ui). It was created 2026-10-26, is Apache-2.0, has about 6,600 stars and is still being pushed to.
- Packages: `@ui-sdk/react` and `@ui-sdk/core`, first published 2026-11-12. The `latest` tag is `0.1.0-beta.13` and the `beta` tag is `0.1.0-beta.14`. The npm maintainer is `shadcn`.
- Site: [ui-sdk.dev](https://ui-sdk.dev). ui-feed.dev shows its components, and every ui-feed prompt recommends it.
- A plain fetch of vercel.com/blog and vercel.com/changelog found no announcement. Those pages may load content with scripts, so this is unverified. It is a Vercel Labs project, not a documented Vercel product.

UI SDK adds no Munari capability to any concept. It could supply the controls inside the Surfaces, such as the note's checkbox and @mention input in concept 1. Those controls would be accessible with no extra work. That saves building time but proves nothing about Munari.

Two cautions apply inside a Surface:

- UI SDK popups stay in place in the DOM and paint in the browser's top layer. Where `showPopover` is missing, they move to a portal on `document.body`. Whether HTML-in-canvas paints top-layer content into a Surface is unmeasured.
- The agent bridge acts through component APIs in JavaScript, so it works the same with or without Munari. A demo where an agent operates a control would show UI SDK, not Munari.
