# finishes

Seventeen tuned finishes for `Surface.Root`'s `finish` prop, and a
suggested text color for each. A preset is a plain `SurfaceFinish` value:

```tsx
import { finishes, inks } from './finishes'

<Surface.Root finish={finishes['lacquer-crimson']}>…</Surface.Root>
<Surface.Root finish={{ ...finishes['lacquer-crimson'], color: '#0d3b66' }}>…</Surface.Root>
```

Each preset is also exported under its own name, in camelCase. A page that
imports only the presets it uses leaves the rest out of its bundle:

```tsx
import { lacquerCrimson } from './finishes'

<Surface.Root finish={lacquerCrimson}>…</Surface.Root>
```

## What to copy

`finishes.ts`. Its only import is the `SurfaceFinish` type from
`@petepetrash/munari`.

## Names

Each name is `<family>-<look>`: `lacquer-crimson`, `polymer-charcoal`,
`aluminum-blue`, `velvet-midnight`, `ceramic-celadon`,
`foil-holographic`, `foil-oil-slick`, `foil-crumpled`, `paper-office`,
`paper-kraft`, `paper-cold-press`, `rubber-black`, `rubber-grip`,
`rubber-silicone`, `wax-candle`, `wax-beeswax` and `wax-silicone`.

## Text color

A finish shades the body; your CSS sets the text color. `inks[name]` gives
a color for body text (`ink`) and one for labels and fine print
(`quietInk`). `ink` is whichever of a near-black and a near-white has more
contrast on the body color. `quietInk` mixes it toward the body while it
keeps 7:1 contrast (WCAG 2.2, criterion 1.4.6) on the body color.

Paint the content root's background with `var(--munari-body)`. Munari sets
it to the finish's `color` on the page and to `transparent` in the canvas,
where the material draws the body.

## While the scene prepares

Until its canvas has built the finish, a Surface shows its page copy. Each
preset's `pageLook` gives that copy a light gradient and edge shading close
to the lit card, so the card is complete from the first frame. Munari sets
them as `--munari-body-image` and `--munari-body-shadow` on the page and
`none` in the canvas. Use both:

```css
.card {
  background: var(--munari-body);
  background-image: var(--munari-body-image, none);
  box-shadow: var(--munari-body-shadow, none);
}
```

The looks were matched by eye and are approximate under a moving light.

## What the tests check

`tests/registry/finishesPack.test.ts` checks that this file is
byte-identical to `apps/lab/src/scenes/material-finishes/recipe/finishes.ts`,
the copy the lab's material-finishes and finish-demo pages render. Every
preset was tuned by eye under `SurfaceCanvas`'s studio lighting; no test
measures how a preset looks.
