// Compile-only public API checks. Root TypeScript includes this file; Vitest
// does not need to run it because the expected failures are the contract.
import type { ComponentProps } from 'react'
import {
  Surface,
  SurfaceApp,
  type FrameSource,
  type PresentationRequirement,
  type SurfaceAppProps,
  type SurfaceProps,
} from '@petepetrash/munari'

declare const frame: FrameSource
declare const presentation: PresentationRequirement
const geometry = <planeGeometry args={[1, 1]} />

;<Surface
  html=""
  width={10}
  height={10}
  onFirstPresented={() => {}}
  onPainted={(receipt) => void receipt.storeSize}
  onFrameDrawn={(receipt) => void receipt.frame.generation}
  presentation={presentation}
  onPresented={(receipt) => void receipt.presentationRevision}
>
  {geometry}
</Surface>
;<Surface html="" emissiveIntensity={0.75}>{geometry}</Surface>
;<SurfaceApp content={<div />} emissiveIntensity={0.75}>{geometry}</SurfaceApp>
;<Surface
  frame={frame}
  width={10}
  height={10}
  onFrameDrawn={(receipt) => void receipt.frame.generation}
  presentation={presentation}
  onPresented={(receipt) => void receipt.presentationRevision}
>
  {geometry}
</Surface>

const mixed = { html: '', frame, children: geometry }
// @ts-expect-error A Surface has one pixel source, never DOM and frames together.
;<Surface {...mixed} />
// @ts-expect-error The legacy DOM-ready callback has no frame semantics.
;<Surface frame={frame} onFirstUpload={() => {}}>{geometry}</Surface>
// @ts-expect-error DOM presentation readiness is not a numbered frame receipt.
;<Surface frame={frame} onFirstPresented={() => {}}>{geometry}</Surface>
// @ts-expect-error FrameSurface owns the renderer fence callbacks.
;<Surface frame={frame} onBeforeRender={() => {}}>{geometry}</Surface>
// @ts-expect-error DOM light is a capture-material term; a frame source owns its pixels.
;<Surface frame={frame} emissiveIntensity={1}>{geometry}</Surface>
// @ts-expect-error SurfaceApp remains a DOM-owned React root.
;<SurfaceApp frame={frame} content={<div />}>{geometry}</SurfaceApp>

const legacy: SurfaceProps = { html: '', children: geometry }
const inferred: ComponentProps<typeof Surface> = legacy
const app: SurfaceAppProps = { content: <div />, children: geometry }
void inferred
void app
