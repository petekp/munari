# Materials and lighting API: the recommended API

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## The recommended API

```ts
// Sketch, not built. Root entry.
type SurfaceDetailKind = 'orange-peel' | 'brushed' | 'pile' | 'glaze' | 'crumple' | 'fiber' | 'dots' | 'honeycomb'

interface FinishValues {
  color: string | null            // null: the HTML paints the body and the whole capture is lit
  text: 'unlit' | 'lit'           // read only when color is set
  roughness: number
  metalness: number
  ior: number
  specularIntensity: number
  coat: { amount: number; roughness: number } | null
  sheen: { amount: number; color: string; roughness: number } | null
  anisotropy: { amount: number; rotation: number } | null
  film: { amount: number; ior: number; thickness: number; variation: number; scale: number } | null
  scatter: { amount: number } | null
  edge: { width: number; rimColor: string | null }   // default { width: 0, rimColor: null }
  detail: { kind: SurfaceDetailKind; scale: number; depth: number } | null
  crackle: { amount: number; scale: number } | null
  emissiveIntensity: number
  environment: 'even' | 'gradient'
  lightGain: number               // 0 or more, scales direct light only
  side: 'front' | 'double'
}

// Every field optional. A missing field takes the neutral default: no layers, color null.
type SurfaceFinish = { [K in keyof FinishValues]?: FinishValues[K] }

// On Surface.Root, <Surface>, SceneSurface.Root and <SceneSurface>.
finish?: SurfaceFinish

type SurfaceLighting = 'studio' | 'none' | {
  key?: SurfaceLight | KeyLight
  rim?: { brightness?: number; elevation?: number } | false   // elevation in degrees
  environmentIntensity?: number
}

interface KeyLight {
  x?: number                          // client CSS px; omitted: the viewport's horizontal center
  y?: number                          // client CSS px; omitted: 0.687 of the viewport's height down
  z?: number                          // CSS px above the page, default 480
  brightness?: number                 // irradiance under the light, 1 is the studio default
  size?: readonly [number, number]    // CSS px; omitted: a point key; given: a softbox
}

interface LightPosition {
  x: number | null                    // null only on the server, when x was omitted
  y: number | null
  z: number
  brightness: number
  size: readonly [number, number] | null
}

interface SurfaceLight {
  set(values: KeyLight): void
  get(): LightPosition
  // Called immediately, then on each set and resize; when following, at most once per frame.
  subscribe(listener: (position: LightPosition) => void): () => void
}

declare function createSurfaceLight(options?: KeyLight & {
  follow?: 'pointer'
  pointerTypes?: readonly ('mouse' | 'pen' | 'touch')[]   // default mouse and pen
  reducedMotion?: 'rest' | 'follow'                       // default 'rest'
}): SurfaceLight

// /advanced. Each input maps the finish's own node to a replacement; the full list is set with the build.
interface FinishMaterialInputs {
  normal?: (finishNormal: Node) => Node
  bodyColor?: (finishBodyColor: Node) => Node
}
declare function useSurfaceFinishMaterial(inputs?: FinishMaterialInputs): MeshPhysicalNodeMaterial | null

// registry/finishes, copied into a project
declare const finishes: Readonly<Record<FinishPreset, Readonly<SurfaceFinish>>>
declare const inks: Readonly<Record<FinishPreset, { ink: string; quietInk: string }>>
type FinishPreset =
  | 'lacquer-crimson' | 'polymer-charcoal' | 'aluminum-blue' | 'ceramic-celadon' | 'velvet-midnight'
  | 'foil-holographic' | 'foil-oil-slick' | 'foil-crumpled'
  | 'paper-office' | 'paper-kraft' | 'paper-cold-press'
  | 'rubber-black' | 'rubber-grip' | 'rubber-silicone'
  | 'wax-candle' | 'wax-beeswax' | 'wax-silicone'
```

### A settings form

A form card on charcoal polymer. The inputs stay real inputs, and the
text stays at the colors the CSS gives it.

```tsx
// Sketch, not built.
import { finishes, inks } from './registry/finishes'

function Settings() {
  return (
    <>
      <SurfaceCanvas id="settings" frameloop="demand" />
      <Surface.Root canvasId="settings" finish={finishes['polymer-charcoal']}>
        <Surface.HTML>
          <form className="settings-card" style={{ '--ink': inks['polymer-charcoal'].ink }}>
            <label>
              Session name
              <input name="session" autoComplete="off" required defaultValue="Morning take" />
            </label>
            <label>
              Input gain (dB)
              <input name="gain" type="number" inputMode="decimal" min={-12} max={12} step={0.5} defaultValue={0} />
            </label>
            <button type="submit">Save</button>
          </form>
        </Surface.HTML>
        <Surface.Scene>
          <Surface.Mesh />
        </Surface.Scene>
      </Surface.Root>
    </>
  )
}
```

```css
/* Munari sets --munari-body: the finish color on the page, transparent in the capture. */
.settings-card { background: var(--munari-body, #3a3d42); color: var(--ink); }
```

### A product card

The shorthand Surface on lacquer in the brand color, with its pipeline
built and its environment baked before the card first appears. The
override changes `color`, so the card picks its own ink.

```tsx
// Sketch, not built.
const card = { ...finishes['lacquer-crimson'], color: '#1d4e89' } satisfies SurfaceFinish

function Product({ item }: { item: Item }) {
  return (
    <Surface canvasId="shop" finish={card}>
      <article className="product" style={{ '--ink': '#f4f1ea' }}>
        <img src={item.image} alt={item.alt} />
        <h2>{item.name}</h2>
        <p>{item.price}</p>
        <button type="button">Add to bag</button>
      </article>
    </Surface>
  )
}

<SurfaceCanvas id="shop" frameloop="demand">
  <Surface.Prewarm finishes={[card]} />
</SurfaceCanvas>
```

### A light that follows the pointer over the looks

Every preset on one canvas under one key light that follows a mouse. A
DOM marker shows where the light is, with no React render per move. On a
touch screen, or under reduced motion, the light rests at its start.

```tsx
// Sketch, not built.
const key = createSurfaceLight({ follow: 'pointer', y: 240 })

function LightMarker() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => key.subscribe(({ x, y }) => {
    if (x === null || y === null) return
    ref.current?.style.setProperty('translate', `${x}px ${y}px`)
  }), [])
  return <div ref={ref} className="light-marker" aria-hidden />
}

function Gallery() {
  return (
    <>
      <SurfaceCanvas id="gallery" frameloop="demand" lighting={{ key }} />
      <LightMarker />
      {(Object.keys(finishes) as FinishPreset[]).map((preset) => (
        <Surface key={preset} canvasId="gallery" finish={finishes[preset]}>
          <Card preset={preset} style={{ '--ink': inks[preset].ink }} />
        </Surface>
      ))}
    </>
  )
}
```

### Two canvases

A header canvas and a content canvas share a theme module and one light.
Each canvas bakes its own environments and builds its own pipelines.

```tsx
// Sketch, not built.
// theme.ts
export const theme = {
  nav: { ...finishes['aluminum-blue'], color: '#7da2d4' },
  panel: { ...finishes['ceramic-celadon'], crackle: null },
} satisfies Record<string, SurfaceFinish>
export const ink = { nav: '#0f1b2b', panel: inks['ceramic-celadon'].ink }
export const key = createSurfaceLight({ x: 960, y: 120, z: 600 })

// App.tsx
<SurfaceCanvas id="header" frameloop="demand" lighting={{ key }} />
<SurfaceCanvas id="content" frameloop="demand" lighting={{ key }} />

<Surface canvasId="header" finish={theme.nav}><Nav style={{ '--ink': ink.nav }} /></Surface>
<Surface canvasId="content" finish={theme.panel}><Panel style={{ '--ink': ink.panel }} /></Surface>

// Moving the light draws one frame on each canvas.
key.set({ x: 400 })
```
