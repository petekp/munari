# Materials and lighting API: the recommended API

Part of the [materials and lighting API proposal](../materials-api.md). Status: proposal. Nothing in it is built, and code blocks marked "Sketch" show an API that does not exist yet.

## The recommended API

```ts
// Sketch — not built.
type FinishPreset = 'lacquer' | 'satin-polymer' | 'anodized-aluminum' | 'glazed-ceramic' | 'velvet'

interface FinishValues {
  color: string | null
  text: 'unlit' | 'lit'
  roughness: number
  metalness: number
  ior: number
  specularIntensity: number
  clearcoat: number
  clearcoatRoughness: number
  sheen: number
  sheenColor: string
  sheenRoughness: number
  anisotropy: number
  anisotropyRotation: number
  iridescence: number
  iridescenceIOR: number
  iridescenceThickness: number
  edgeWidth: number
  detail: 'none' | 'orange-peel' | 'brushed' | 'pile' | 'glaze'
  detailScale: number
  detailDepth: number
  rimColor: string | null
  crackle: number
  crackleScale: number
  emissiveIntensity: number
  environment: 'even' | 'gradient'
  lightGain: { key: number; rim: number }
  side: 'front' | 'double'
}

type SurfaceFinish = FinishPreset | ({ preset?: FinishPreset } & Partial<FinishValues>)
declare const finishes: Readonly<Record<FinishPreset, Readonly<FinishValues & { ink: string; quietInk: string }>>>

// Surface.Mesh, SceneSurface.Mesh and <Surface>
type FinishOrMaterial = { finish?: SurfaceFinish; material?: never } | { finish?: never; material?: ReactElement | THREE.Material }

type SurfaceLighting =
  | 'studio' | 'softbox' | 'room' | 'none'
  | { rig?: 'studio' | 'softbox' | 'room'; key?: SurfaceLight | Partial<LightPlacement>; rim?: { power?: number; elevation?: number } | false; environmentIntensity?: number }

interface LightPlacement {
  x: number      // client CSS px
  y: number      // client CSS px
  z: number      // CSS px above the page
  power: number  // irradiance straight under the light
}

interface SurfaceLight {
  set(values: Partial<LightPlacement>): void
  get(): Readonly<LightPlacement>
  subscribe(listener: (values: Readonly<LightPlacement>) => void): () => void
}
declare function createSurfaceLight(options?: Partial<LightPlacement> & { follow?: 'pointer' }): SurfaceLight
```

### A settings form

A form card on satin polymer. The inputs stay real inputs, and the text
stays at the colors the CSS gives it.

```tsx
// Sketch — not built.
function Settings() {
  return (
    <>
      <SurfaceCanvas id="settings" frameloop="demand" />
      <Surface.Root canvasId="settings">
        <Surface.HTML>
          <form className="settings-card">
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
          <Surface.Mesh finish="satin-polymer" />
        </Surface.Scene>
      </Surface.Root>
    </>
  )
}
```

```css
.settings-card { background: #3a3d42; color: #f2f2f2; }
/* Question 4: how CSS learns the Surface is in the scene. */
[data-munari-presented="scene"] .settings-card { background: transparent; }
```

### A product card

The shorthand Surface on lacquer in the brand color, with its pipeline
built before the card first appears.

```tsx
// Sketch — not built.
const card = { preset: 'lacquer', color: '#1d4e89' } satisfies SurfaceFinish

function Product({ item }: { item: Item }) {
  return (
    <Surface canvasId="shop" finish={card}>
      <article className="product">
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

### A light that follows the pointer over a page

Five cards in the five picked looks under one key light that follows the
pointer. A DOM marker shows where the light is, with no React render per
move.

```tsx
// Sketch — not built.
const key = createSurfaceLight({ follow: 'pointer', z: 480, power: 1.55 })

function LightMarker() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => key.subscribe(({ x, y }) => {
    ref.current?.style.setProperty('translate', `${x}px ${y}px`)
  }), [])
  return <div ref={ref} className="light-marker" aria-hidden />
}

function Gallery() {
  return (
    <>
      <SurfaceCanvas id="gallery" frameloop="demand" lighting={{ rig: 'studio', key }} />
      <LightMarker />
      {(['lacquer', 'satin-polymer', 'anodized-aluminum', 'glazed-ceramic', 'velvet'] as const).map((preset) => (
        <Surface key={preset} canvasId="gallery" finish={preset}>
          <Card preset={preset} />
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
// Sketch — not built.
// theme.ts
export const theme = {
  nav: { preset: 'anodized-aluminum', color: '#7da2d4' },
  panel: { preset: 'glazed-ceramic', crackle: 0 },
} satisfies Record<string, SurfaceFinish>
// Text colors for each, used in CSS as var(--ink).
export const ink = { nav: finishes['anodized-aluminum'].ink, panel: finishes['glazed-ceramic'].ink }
export const key = createSurfaceLight({ x: 960, y: 120, z: 600, power: 1.4 })

// App.tsx
<SurfaceCanvas id="header" lighting={{ key }} />
<SurfaceCanvas id="content" frameloop="demand" lighting={{ rig: 'softbox', key }} />

<Surface canvasId="header" finish={theme.nav}><Nav style={{ '--ink': ink.nav }} /></Surface>
<Surface canvasId="content" finish={theme.panel}><Panel style={{ '--ink': ink.panel }} /></Surface>

// Moving the light redraws both canvases once.
key.set({ x: 400 })
```
