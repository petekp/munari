# ui-feed.dev: study notes

ui-feed.dev is a feed of 89 interactive pieces, studied on 2026-11-23. Each piece rebuilds one UI SDK component as a physical object. A color picker becomes a prism. A rating becomes five candles. A password field becomes fogged glass. UI SDK is the component library that vercel-labs published on 2026-11-12, covered in [munari-demo-ideas.md](munari-demo-ideas.md#vercels-ui-sdk).

The site shows one piece per screen in a black frame. Snap scrolling, `j`/`k` and `h`/`l` move between pieces and their variants. Each piece has thumbs up and down, a link to its component's docs, and a "copy prompt" button. That button copies a prompt to restyle your own UI in the piece's look, followed by the piece's full React and CSS source.

## How this was studied

I opened the feed in headless Chrome at 1440 × 900 and interacted with 15 pieces by mouse and keyboard. Two more were seen at rest only. I saved resting and post-input screenshots under `.scratch/ui-feed/`, which Git does not track. I also saved the copied source of all 89 pieces and searched it for techniques.

These limits apply to what follows:

- Headless input has no touch, pressure or trackpad momentum. Single screenshots taken 120 to 250 ms after input stand in for motion, so smoothness was not judged.
- Hover was reproduced with a mouse move. Hover-intent timing was not tested.
- No piece uses sound. A search of all 89 sources found no audio API, so headless capture lost nothing there.
- The VCR timer and Hologram pieces were seen at rest only.
- Technique counts below come from regular-expression searches of the source. They count files that match, and a few may be wrong.

## The pieces

### Prism (color picker)

A white beam enters a glass prism on a protractor. The spectrum leaves through a slit, and the color at the slit is the picked color. Readouts give hex, wavelength in nm, hue and prism angle. Rotating the prism changes the color: 43.4° gave #1000FF at 459 nm, and 24.2° gave #00FF7B at 507 nm.

The concept is that color is light, so picking a hue means choosing a wavelength. The optics are computed rather than drawn. The source models dispersion with Cauchy's equation and reflection with Fresnel's equations, and traces each ray through up to seven bounces. At 24.2° an internally reflected violet ray left the prism's far side, a detail an illustrator would not invent. The black field makes the beam the only color on screen. The prism is imprecise by nature, so a hex field stays beside it for exact values. The piece ships three variants.

### Mercury tilt switch (switch)

A cream thermostat dial in a brass ring sits on teal felt, with a glass tube of mercury on a pivot. Toggling tips the tube. The mercury runs to the contacts, a jewel lamp lights, and "Off" becomes an amber italic "On".

A switch is on when metal touches metal. The mercury stretches and sloshes in flight: the mid-motion frame showed a long, rippled blob. The lamp's glow warms the dial face around it. The simulation runs on a fixed 120 Hz step. A large serif label pair, "Heating" and the state word, states what the object shows.

### Newton's cradle (switch)

Five steel balls hang from a bar. The middle ball sits inside a pill-shaped switch track. Toggling slides it across, it strikes its neighbor, and the far ball swings out and back. The track turns dark green and "Off" becomes "On".

The thumb is a ball of the cradle, so the control is part of the object rather than placed beside it. The swing after the click gives the state change a consequence that outlasts the input.

### Candles (rating)

Five tapers stand on slate under the question "How was the evening?" Choosing 5 brings in a match that lights the unlit candles. Choosing 1 snuffs four flames, each leaving a curl of smoke, and the whole room darkens.

The rating is a quantity of light, and the environment answers: the floor and backdrop brighten or dim with the number of flames. The match and the smoke add a small story to each change, and the smoke briefly keeps the old value visible. The piece draws with raw WebGL 2 and a wide-gamut P3 buffer where the display supports one.

### Pendant lamp (hover card)

Five sepia portraits sit on dark wood under a pendant lamp. Hovering a person slides the lamp along its cable to hang over them. The cable tilts while it travels and the lamp swings before settling. Their card sits in the pool of light and the others fall into shadow.

Hovering means putting a light on someone. The card is plain dark UI. All the character comes from the light's inertia and from warming the lit face while the rest go grey.

### Fogged glass (password input)

A "Wi-Fi password" field is a pane of fogged glass with a warm glow at its left edge. Each typed character clears a small hole, ringed with droplets, where the character shows. Dragging wipes a streak that drips. The eye button clears the whole pane. Behind it is a living room whose lamp explains the glow, and the full password.

Secrecy is condensation: you see only what you wipe. The reveal answers a question the viewer did not know they had, where the glow came from. Droplets have mass and drip past a threshold, and wipes depend on pointer pressure and speed.

### Tumble calendar (date input)

A brushed-steel desk calendar has month, day and year blocks above a plain date field. Changing the month with an arrow key tumbles the month block over its axle to the next face.

This is the one piece built with three.js. A grain shader dithers the steel. The ordinary date field below does the exact work, and the object mirrors it.

### Sundial (time input)

A stone sundial inscribed "51°30' N" sits under a 15:20 time field. Dragging across the plate moves the sun, and the gnomon's shadow and the time follow. At 10:21 the shadow is short and close to the blade.

Time is where the shadow falls. The geometry is real: latitude 51.5° and solar declination 23.44°, which is midsummer in London. The piece reads the time under the pointer, so pointing at an hour line sets that hour.

### Seismograph event list (resizable)

An amber-on-black terminal in a blue case reads "REYKJANES NET" with a UTC clock. It shows five minute-long traces with P and S wave picks, and a table of earthquakes near Grindavík. Dragging the divider up collapses the traces to the current minute and shows more of the table.

A resizable split is framed as an instrument that trades the live signal for the record. The piece earns belief with specifics: an S–P interval of 2.2 s, depths in km, real Icelandic place names. The newest trace keeps drawing.

### Riffle (pagination)

An open book shows a number in five languages on the left and a large Didone numeral on the right. Clicking 24 from page 1 riffles every page in between before landing.

Jumping a long way should feel long. The riffle makes the distance visible without making the user wait long, and the book stops at 24 pages.

### Morse key (autocomplete)

A grocery-list autocomplete sits above a photographed brass telegraph key. Each suggestion shows the Morse code for its next letter. Pressing the key with the pointer, Space or Enter taps dots and dashes, which decode into letters and filter the list. Typing works too.

The list teaches the user what to send next. The key is a cut-out photograph whose lever pivots, so the material looks real without a render.

### Frost alarm (switch)

A yellow outdoor thermometer shows 36.4 °F on a large LCD, an overnight low of 28.8 and a forecast bar chart. Turning the slide switch on draws the alarm threshold, 34.0, as a dotted line across the forecast. A bell marks where the forecast crosses it.

The switch's meaning is shown on the data: you see when the alarm will ring. Unlit LCD segments show faintly and the glass carries glare stripes, two details of the real device.

### Kinetic poster (tabs)

Day, Week, Month and Year tabs sit over a step count set in condensed type across an electric-blue card. Choosing Month changes 58,204 to 241,870 and +12% to +9%. The selected tab turns black-weight on chartreuse, and other tabs change weight over 300 ms.

This piece has no simulation. It shows the collection's range: a strong typographic idea is enough.

### Clay (switch)

A lavender clay switch holds a cream knob with a bell icon. Pressing squashes the knob flatter and wider. Releasing slides it across, the bell becomes a moon, the track goes from peach to mint and "Off" becomes a green "On".

The squash on press is anticipation before travel, and it makes the material read as soft.

### Spatial glass (select)

A frosted-glass select reading "Reading" floats over a blurred living room at dusk. Its options are Evening, Reading, Movie night, Dinner and Bedtime. The open list takes on the room's colors, with the lamp glowing through.

The options name lighting scenes for the room behind them, so the control floats in the place it controls.

### Seen at rest only

The VCR timer is the blue on-screen menu of a video recorder, with a CRT shader and a field that blinks again after each key press. Hologram is a cyan, scanlined color picker with chamfered corners.

## What the collection does

- Each piece pairs one component with one physical object whose physics is the component's rule. A rating is light, a switch is conduction or momentum, time is a shadow, secrecy is fog and color is wavelength.
- A change has a consequence beyond the control. Smoke rises, the room darkens, a threshold line appears or a ball swings. Most pieces have a moment after the click.
- The real control stays readable. A plain field or readout sits beside the object for precision: hex, date, time and step counts. The pieces are built on UI SDK components, so keyboard and screen-reader support come with them. Sixteen sources handle reduced motion.
- Each world is specific. Reykjanes, Grindavík, 51°30' N, 459 nm and 28.8 °F are real places and units. The VCR menu, LCD ghost segments and telegraph key are real devices. The specifics supply the character.
- Each piece is restrained. It has one object, one accent color and one statement in display type, such as "Heating · On". The frame around it is tiny monospace on black.
- Each piece picks a typeface for its world. Bodoni Moda, Barlow Condensed, Archivo, Instrument Serif and Chakra Petch are the most used, with VT323 for screens.
- The physics is real but the means are cheap. Most pieces use CSS, SVG and canvas 2D. Nine use WebGL and one uses three.js. Depth often comes from photographs: the telegraph key, the room, the portraits. Simulations run on fixed steps.
- The pacing is quick. Interactions resolve in under a second, usually with overshoot. Idle motion is rare and belongs to the object, like a flame's flicker or a live trace.
- Nothing makes a sound. All the tactility is visual.

## What this means for Munari

In ui-feed, the physical object is drawn next to an ordinary control, and the two stay separate. The fog is a canvas over an input. The thermostat is a picture of a switch. Munari can remove that gap: the real HTML control can be the object. Its own pixels can bend, take light, cast shadows and carry a shader, while it keeps its caret, focus and state. The concepts in [munari-demo-ideas.md](munari-demo-ideas.md) start from that difference.
