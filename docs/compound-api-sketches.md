# Compound API sketches

> Status: superseded working material from the Revision 3 design process
> (2026-08-17). Do not implement these sketches. The corrected proposal and
> acceptance sketches live in `docs/public-api-proposal.md`.

## Rules of the exercise

Each sketch uses the compound model plus one amendment under test: the
subcomponents work in **two wiring styles** with the same names and the
same law underneath.

- **Colocated:** `<Surface source>` wraps `Surface.DOM` / `Surface.WebGL`
  children. The WebGL child tunnels to a canvas host and defaults to
  `match-dom`. No hooks, no handle.
- **Separated trees:** the same `<Surface source>` declares content in
  the app tree with an explicit `surface` handle, and `<Surface.WebGL
  surface={...}>` is a native mesh placed anywhere inside a
  `SurfaceCanvas` scene graph.

Assumed surface identity API: `useSurface(options)` inside a component,
and `createSurface(options)` outside React for data-driven fleets —
hooks cannot be called in a loop over 33 panels, so identity must be
creatable in a store. (`useSurface` is the memoized component-scoped
form of the same thing.)

`source` accepts `ReactElement | HTMLElement`. A sketch that needs an
advanced import says so — that is data, not failure.

Each sketch records: what the real scene does, the sketch, what held,
what creaked.

---

## 0. Gold Button — the baseline the compound was designed for

One `SurfaceCanvas` mounted once at the app root serves every surface
in these sketches unless a scene owns its own canvas.

```tsx
const [view, setView] = useState<'dom' | 'webgl'>('dom')

<Surface
  source={
    <button className="gold" onClick={() => setView('webgl')}>
      Make it gold
    </button>
  }
  view={view}
>
  <Surface.DOM />
  <Surface.WebGL material={<GoldSparkleMaterial />} />
</Surface>
```

**Held:** six lines, zero hooks beyond `useState`, no `as` prop, no
prop-forwarding contract — the user writes a real `<button>`. The
handoff engages because `view` is present; reversal is a prop change.

---

## 1. Workspace — resident fleet, shared scene, mixed focus

**The real scene:** 33 panels as permanent WebGL matter in one canvas
the app shell owns, arranged by `arcLayout` under a `FocusScene` with
`OrbitControls`; DOM content and `Dial` controls share one tab order;
panel width is swept as a prop; quiescent panels must cost 0 paints/s.

```tsx
// Panel store — identity lives with the data, not in a hook.
const panels = usePanelStore()
// each entry: { id, width, height, surface: createSurface({ name: `panel:${id}` }) }

// App tree: content under the real providers. No Surface.DOM — these
// panels have no page presence. One line per panel declares the source.
{panels.map((p) => (
  <Surface
    key={p.id}
    surface={p.surface}
    source={<Panel id={p.id} selection={selection} />}
    size={[p.width, p.height]}
  />
))}

// Scene: meshes are ordinary scene-graph children of the rig.
<SurfaceCanvas>
  <FocusScene>
    <OrbitControls />
    {panels.map((p, i) => (
      <Surface.WebGL
        key={p.id}
        surface={p.surface}
        position={arcLayout(i, panels.length)}
      />
    ))}
    <Dial value={zoom} onDetent={setZoom} position={dialSlot} />
  </FocusScene>
</SurfaceCanvas>
```

**Held:** residence is inferred — no `Surface.DOM`, no `view`, no mode
prop. Portal capture makes the old per-panel feeds ordinary props
(`selection` just flows). `Surface.WebGL` registers with the enclosing
focus tree automatically; `Dial` is a leaf beside it. `arcLayout` stays
consumer code.

**Creaked:** the colocated compound never appears. The scene *is* the
separated style: meshes must be children of the orbit rig, which a
tunneled port cannot express. And identity had to move out of hooks —
`createSurface` in the store is a requirement this sketch discovered,
not a nicety.

---

## 2. Explode — adopted elements under animated ancestors

**The real scene:** twelve plates built by `cloneNode` plus injected
neutralizing styles — constructed DOM that cannot round-trip through
JSX — rendered as resident matter whose explosion is ancestor group
transforms.

```tsx
const plates = useMemo(
  () =>
    buildPlates(rootElement).map((p) => ({
      ...p,
      surface: createSurface({ name: `plate:${p.id}` }),
    })),
  [rootElement],
)

// App tree: adoption is the same source prop with an element in it.
{plates.map((p) => (
  <Surface key={p.id} surface={p.surface} source={p.node} size={[p.w, p.h]} />
))}

// Scene: the explosion is parent transforms, exactly as shipped.
<SurfaceCanvas>
  <group rotation={assemblySpin}>
    {plates.map((p) => (
      <group key={p.id} position={explodedPosition(p, spread)}>
        <Surface.WebGL surface={p.surface} alpha="source" />
      </group>
    ))}
  </group>
</SurfaceCanvas>
```

**Held:** `source: ReactElement | HTMLElement` absorbs adoption — no
`AdoptedSurface` component to learn, no portal for adopted nodes.
Residence again inferred from composition.

**Creaked:** nothing new — but this is the sketch that proves the
placement argument. Every plate lives under two consumer-owned animated
groups. A flat port has no way to say that; the standalone mesh form is
not an escape hatch here, it is the scene.

---

## 3. Veil — twin: both presenters visible forever

**The real scene:** the page element stays fully visible while a mesh
shows a treated copy of the same pixels, permanently. No handoff ever.

```tsx
<Surface source={<VeilSheet />}>
  <Surface.DOM />
  <Surface.WebGL
    host="veil-card"
    material={<VeilMaterial />}
    pointerEvents="none"
  />
</Surface>

<SurfaceCanvas id="veil-card" style={cardBox} />
```

**Held:** the twin shape is the compound at its best — both presenters
declared, no `view`, nothing arbitrates. `pointerEvents="none"` keeps
the treated copy decorative. This is the one scene where the colocated
form carries everything.

**Creaked:** the host association question stops being hypothetical.
Veil wants its own inline canvas, not the app's overlay, so the
tunneled `Surface.WebGL` must name its destination (`host` here).
Standalone-in-canvas needs no association — it is already inside its
host — so the rule is small: tunneled forms resolve to the single
registered host by default and take `host` when there are several.

---

## 4. Knobs — resident instrument, anchors, focus leaves

**The real scene:** one captured board in a scene-owned canvas with a
pixel-locked camera; physical `Dial` meshes sit at positions declared
inside the content (`data-munari-anchor`); dials and captured DOM share
focus; the library must stay the single writer of the host box.

```tsx
const board = useSurface({ name: 'knobs' })

<Surface
  surface={board}
  source={<KnobBoard values={values} />}
  size={[520, 360]}
/>

<SurfaceCanvas camera={pixelLockedCamera}>
  <FocusGroup id="board">
    <Surface.WebGL surface={board}>
      {anchorIds.map((id) => (
        <SurfaceAnchor key={id} anchor={id}>
          <Dial value={values[id]} onDetent={(v) => setValue(id, v)} />
        </SurfaceAnchor>
      ))}
    </Surface.WebGL>
  </FocusGroup>
</SurfaceCanvas>
```

**Held:** the WebGL control drives the DOM content through shared React
state (`values`), with no bridge code — the portal capture win again.
Anchored companions read naturally as children that ride the surface.
Focus stays orthogonal: `FocusGroup` wraps, the surface registers as a
composite, `Dial` as a leaf. Authored `size` keeps the single-writer
rule.

**Creaked:** `SurfaceAnchor` is an advanced import appearing in a
normal-looking scene — acceptable for an instrument, but the sketch
confirms anchors earned their promotion out of the registry. The
colocated form again does not appear; knobs owns its canvas and camera.

---

## 5. Logo — multi-part atomic handoff, timed

**The real scene:** six letters cross together or not at all; each page
letter is a measuring rig and its captured twin is a purpose-built tree
in different units; letter meshes sit on the scene's own em grid because
reading boxes back from the DOM quantizes to whole pixels; the timed
ramp is the motion.

```tsx
<Surface view={view} timing={{ settleMs: SETTLE_MS }}>
  {WORD.map((letter) => (
    <Surface.Part
      key={letter.id}
      id={letter.id}
      source={<PageLetter letter={letter} />}
      capture={<TwinLetter letter={letter} />}
    >
      <Surface.DOM />
      <Surface.WebGL
        placement="manual"
        position={emGrid(letter)}
        material={<InkMaterial />}
      />
    </Surface.Part>
  ))}
</Surface>
```

**Held:** this is the strongest case for `Surface.Part`. Presenter
accounting disappears — the expected set derives from the parts, a
missing WebGL part keeps DOM visible, and atomicity is the handle's
scope. Per-part divergent `capture` matches the shipped twin exactly.
The timed driver is the default; no driver prop appears.

**Creaked:** two soft spots. Tunneled `Surface.WebGL` must accept mesh
transforms (`position` here) for `placement="manual"` to mean anything —
a passthrough requirement, not a redesign. And the letters are flat
children today, so colocation works; the moment the word wants a
scene-graph rig (a group that tilts the whole wordmark), the WebGL
halves move into the canvas in the separated style. The compound
survives logo as shipped, one rig short of not surviving it.

---

## 6. Genie — concurrent driven handoffs, one canvas

**The real scene:** four windows, each independently liftable while
others are mid-flight or landed; progress is scrubbed by the hand along
a pour path with a velocity-clamped catch-up; meshes nest in stacking
groups with warp geometry and shadow companions; the film window
composites frozen video frames through the frame contracts; warm-up
draws with color writes disabled and the page releases on the
presentation receipt.

```tsx
// Desk store owns identity and one driver per window.
// each window: { id, surface: createSurface(...), pourDriver }

function DeskWindow({ win }: { win: Win }) {
  const away = useDesk((s) => s.away[win.id])
  return (
    <Surface
      surface={win.surface}
      source={<WindowBody win={win} />}
      view={away ? 'webgl' : 'dom'}
      driver={win.pourDriver}
      timing={{ settleMs: 0 }}
    >
      <Surface.DOM />
    </Surface>
  )
}

<SurfaceCanvas>
  {order.map((id, stack) => (
    <group key={id} renderOrder={stack} position={windowWorld(id)}>
      {wins[id].kind === 'video' ? (
        // Film composite wraps the advanced frame contracts.
        <Surface.WebGL
          surface={wins[id].surface}
          placement="manual"
          geometry={<warpGeometry />}
          material={<FilmComposite source={wins[id].frames} />}
        />
      ) : (
        <Surface.WebGL
          surface={wins[id].surface}
          placement="manual"
          geometry={<warpGeometry />}
          material={<WarpMaterial />}
        >
          <ShadowQuad />
        </Surface.WebGL>
      )}
    </group>
  ))}
</SurfaceCanvas>
```

The driver is where genie's hand lives: `pourDriver.frame()` returns
scrubbed progress; the law clamps it to zero through `page` and
`lifting` and completes the return only when the driver reports zero.
The velocity-clamped catch-up and the reverse bridge are driver
internals, not library API.

**Held:** four concurrent handoffs are four `<Surface view>` elements in
one canvas — the multi-handle model with no ceremony. Intent (`view`),
hold (receipts, internal), and motion (`driver`) separate exactly as
proposed. The normal model expresses the whole window lifecycle; only
the film composite reaches into advanced, which is where it belongs.

**Creaked:** the compound carries only the DOM half; every mesh lives in
the separated style under stacking groups. `timing={{ settleMs: 0 }}`
is doing quiet work (these windows have no idle motion to settle) — the
sketch suggests `settleMs` should be documented as "time for *your*
DOM-side motion to stop," not as a magic pause.

---

## Scorecard

Where each wiring style carried the scene:

| Scene | Colocated compound | Separated trees |
|---|---|---|
| Gold Button | the whole scene | — |
| Workspace | — | the whole scene |
| Explode | — | the whole scene |
| Veil | the whole scene (with `host`) | — |
| Knobs | — | the whole scene |
| Logo | the whole scene (flat placement) | needed the moment a word rig exists |
| Genie | the DOM half | the WebGL half |

The compound model holds as the public center: every sketch reads as
"this thing is a Surface," the presentation mode is inferred from
composition in all seven, and no sketch needed a mode prop, presenter
counts, receipt keys, phases, or `tick()`. But the colocated form alone
carries two scenes out of seven. The two-wiring rule is not a
compatibility concession — it is half the API. `useSurface` /
`createSurface` and the standalone `Surface.WebGL` belong in the normal
entry point, second story, same names.

## Requirements these sketches discovered

- **`createSurface()` outside React.** Dynamic fleets (workspace 33,
  explode 12, genie 4) keep identity in stores; a hook cannot be called
  in a loop. `useSurface` becomes the memoized component-scoped form.
- **Host association for tunneled meshes.** Default to the single
  registered `SurfaceCanvas`; a `host` prop names the destination when
  an inline canvas coexists with an overlay (veil). Standalone meshes
  need nothing — they are already inside their host.
- **Mesh-transform passthrough on tunneled `Surface.WebGL`** so
  `placement="manual"` works in the colocated form (logo).
- **`source: ReactElement | HTMLElement`** absorbs adoption; no
  `AdoptedSurface` (explode).
- **Inference diagnostics**: `view` with fewer than two presenters,
  duplicate `Surface.DOM`, part-id collisions — each needs a dev
  warning stating what was inferred. Seven scenes of inference with no
  diagnostics would be a mystery novel.

## What this changes in the proposal

The component sections and entry-point lists of revision 2 get rewritten
around `Surface` / `Surface.DOM` / `Surface.WebGL` / `Surface.Part` +
`SurfaceCanvas`, with the focus kit unchanged. Everything below the
public layer survives revision 2 untouched: the per-handle crossing and
color-write warm-up law, the two-stage receipts, capture staging
mechanics, the driver contract, anchors in advanced, and probes 0–7.
One migration note gets louder: the name `Surface` moves from "mesh
inside the canvas" (current API) to "content declaration in the page
tree" — legal at a major version, but the table must shout it.
