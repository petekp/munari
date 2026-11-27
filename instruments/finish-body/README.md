# finish-body

`npm run probe:finish-body` records the finish-demo bench while its settings
card moves between the page and the scene, on the native engine and on
snapDOM. It checks that no frame shows the page behind the card
([decisions.md #79](../../docs/decisions/renderer.md)).

The cases:

- the page takes over
- a lift
- a lift with a field focused on the page
- a body color change in the scene
- renderer loss after a return

Every recorded image must show the card's body in a band of its top padding.
An image where more than half the band matches the page ground fails. Each
engine must first catch a one-frame ground patch over the band, and a
recording that skips a page frame is retried up to three times.

A last page clicks a button, a segment and a play control through the scene,
types into a field, and checks each result in the DOM.

The band covers one edge of one card, so text and other cards are not judged.
`FINISH_BODY_ENGINES=auto` or `snapdom` runs one engine. This local probe is
not in CI.
