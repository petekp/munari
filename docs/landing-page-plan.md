# Landing page plan

Status: built on branch `pkp/landing-redesign`, uncommitted, 2026-10-04.
[Decision #69](decisions.md#69) records the contract.

The new landing page opens with a prompt for a coding agent, and the demo that
prompt describes runs beside it. The visitor picks a verb, such as throw or
bend, and both the prompt and the demo change. A grid of all demos and a short
setup guide follow. The current masthead, with its lamp and postcard, leaves
the landing page. The lamp and the postcard become separate demos.

## Page order

1. Header. The animated Munari wordmark on its dark plate, at the left. Links
   to Demos, Setup, and GitHub at the right. No sidebar on the landing page.
2. Hero, left column. The tagline "HTML, 3D, and Shaders, Unified.", one
   sentence about what Munari is, and then the prompt as the headline:
   "Use Munari to throw my task cards between columns." The verb is a picker.
   The underlined words are an editable field for the visitor's own
   component. A Copy prompt button copies the full prompt, which starts by
   telling the agent to read the Munari skill in `node_modules`.
3. Hero, right column. The demo for the chosen verb, running live, on that
   demo's color, with a one-line instruction and a link to its own page.
   Browsers with HTML-in-canvas capture through it. Every other browser
   captures through snapDOM, so every visitor gets a live demo.
4. Demos. All eight demos as thumbnails. Each opens its live page.
5. Setup. Three numbered steps: install the package, point the agent at the
   skill, and describe the effect. Step 3 repeats the prompt from the hero.
   Links to a hand-written first Surface and to browser support.
6. Footer.

The verbs and their demos:

| Verb | Demo | Example prompt |
|---|---|---|
| bend | Genie | my settings window when it minimizes |
| throw | Flight | my task cards between columns |
| light | Light, new as its own demo | my landing page with a lamp the visitor can drag |
| dissolve | Plume | the text in my search field after it is submitted |
| refract | Selection | the text a reader selects in my article |
| reflect | Marble hand | my page in a sculpted cursor |
| press | Knobs | my settings panel as physical controls |
| write on | Postcard | my signup form as a printed card |

## Visual design

- White page and black text. The wordmark keeps its own colors on its dark
  plate, because its palette was tuned on a dark background.
- Archivo for all text, at several widths. The chosen verb in the prompt is
  set extra wide on the demo's color from `sceneCatalog.ts`. That color also
  fills the panel behind the demo, so the verb and its demo read as one
  choice.
- Commands and prompts in the setup steps use Courier Prime on dark slips,
  each with a Copy button.
- Both fonts are already served by the lab.

## What was checked

- Typecheck, lint and unit tests pass.
- In headless Chrome at 1440×1000, every verb loads its demo in the hero, using
  HTML-in-canvas with the Chrome flag and snapDOM without it. No page errors.
- The copied prompt contains the install line, the skill path and the
  visitor's own component name.
- Each example prompt was given to a separate coding agent working from a
  package built from this checkout. All eight apps build, load in Chrome 157
  without page errors, and draw their canvases. In the three with a button,
  pressing it worked: the window minimized into the dock, the power toggled,
  and the postcard tilted while staying a working form. How good each effect
  looks was not judged.

## Open questions

- The npm release is 0.3.0, older than the API these prompts use. The page
  says so and links to building from source. A release should come before
  launch.
- The package's agent docs need fixes before launch. In every test run, the
  agent found that `SKILL.md` points to `docs/authoring.md` and
  `docs/agent-workflow.md`, neither of which ships in the package. The
  packaged README is written for the repository checkout. Neither file
  mentions snapDOM or `@types/three`.
- The mobile layout stacks the hero and scales the demo from a 720px layout.
  It renders at 390px but has had no design review.
- Inside a frame, Light and Postcard show their lighting while it prepares,
  as every other scene does. The old inline page hid that behind the cover.
- The Light and Postcard colors and thumbnails are first choices:
  `#e3ec5a` and `#8f9cf5`, with captures of each page as thumbnails.
- The running starter example, `HomeStarter`, was removed with the old page.
  The README's first-Surface code block remains.

Sketches and mockups were reviewed in Vignette on 2026-10-03.
