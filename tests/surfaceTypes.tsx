// Compile-only contracts for the public API; included by the root TypeScript program.
import type { ComponentProps } from 'react'
import {
  Surface, SceneSurface, SurfaceCanvas, createSurface, useSurfaceHandle,
  useSurfaceStatus, useSurfaceDriver, useSurfaceProgress, useSurfaceSupport, supportsSurfaces,
  useElementCapture, CaptureContent, useCaptureHandle, usePageTarget, useSurfaceBeforeRender,
  type SurfaceHandle, type SurfacePresentation, type SurfaceDestination, type SurfaceProps,
} from '@petepetrash/munari'
import { FrameSurface, type FrameSource, type PresentationRequirement } from '@petepetrash/munari/advanced'

declare const frame: FrameSource
declare const presentation: PresentationRequirement
declare const handle: SurfaceHandle
declare const detached: HTMLElement
const geometry = <planeGeometry args={[1,1]} />

;<SurfaceCanvas id="example" />
;<Surface inScene={false} canvas="example" name="card" timing={{settleMs:300}} onPresentationChange={value=>{const hold:SurfacePresentation=value;void hold}} onMotionComplete={value=>{const destination:SurfaceDestination=value;void destination}}><button>One live instance</button></Surface>
;<FrameSurface frame={frame} width={10} height={10} onFrameDrawn={receipt=>void receipt.frame.generation} presentation={presentation} onPresented={receipt=>void receipt.presentationRevision}>{geometry}</FrameSurface>
// @ts-expect-error The frame adapter owns its draw fence.
;<FrameSurface frame={frame} onBeforeRender={()=>{}}>{geometry}</FrameSurface>
// @ts-expect-error A basic Surface contains HTML, rather than a separate source prop.
;<Surface inScene={false} source={<div/>}><div/></Surface>
// @ts-expect-error Renderer requests are a boolean on Surface.
;<Surface renderIn="both"><div/></Surface>
// @ts-expect-error The old duplicated DOM presentation is removed.
;<Surface.DOM surface={handle}/>
// @ts-expect-error Named HTML parts replace the old source-bearing Part component.
;<Surface.Part name="old" source={<div/>}/>
// @ts-expect-error Custom materials belong on the scene mesh.
;<Surface inScene material="none"><div/></Surface>
// @ts-expect-error The high-level Surface requires its boolean intent.
;<Surface><div/></Surface>
// @ts-expect-error One owner supplies the identity.
;<Surface inScene surface={handle} name="duplicate"><div/></Surface>
// @ts-expect-error A Surface does not accept raw markup strings as an HTML prop.
;<Surface inScene html="<b>text</b>"/>
// @ts-expect-error A SceneSurface needs explicit dimensions.
;<SceneSurface><div/></SceneSurface>
// @ts-expect-error Size has two dimensions.
;<SceneSurface size={[10,20,30]}><div/></SceneSurface>
// @ts-expect-error Frame input has its own adapter.
;<Surface inScene frame={frame}><div/></Surface>
// @ts-expect-error Cleanup is owned by Surface.Scene.
;<Surface inScene onWebGLReleased={()=>{}}><div/></Surface>

void createSurface();void createSurface('card')
// @ts-expect-error A handle owns identity, not renderer intent.
void createSurface('card',{inScene:true})
// @ts-expect-error The name is a string, not an options bag.
void createSurface({name:'card'})
const basicProps: SurfaceProps={inScene:false,children:<div/>}
const inferredProps: ComponentProps<typeof Surface>=basicProps
void inferredProps
function Observations() {
  const own=useSurfaceHandle('explicit')
  const state=useSurfaceStatus(own)
  const hold: SurfacePresentation=state.presentation
  const raw:number=useSurfaceProgress(own).get()
  const eased:number=useSurfaceProgress(own).eased()
  useSurfaceDriver(({target,progress})=>target==='scene'?progress:0,own)
  useSurfaceDriver(null,own)
  void useSurfaceSupport();void supportsSurfaces();void [hold,raw,eased]
  // @ts-expect-error Renderer mount duty is private.
  void state.isWebGLMounted
  // @ts-expect-error Canvas is not a public destination.
  const oldDestination:SurfaceDestination='canvas'
  void oldDestination
  return <Surface surface={own} inScene={false}><div/></Surface>
}
void Observations

function RevisionTwoExamples() {
  const attached = useElementCapture()
  const authored = useCaptureHandle()
  const hidden = Math.random() > 0.5
  // @ts-expect-error A callback ref is returned by this hook; a plain ref object is not an options object.
  useElementCapture({ current: null })
  // @ts-expect-error The opaque scene prop is no longer part of the simple wrapper.
  const oldScene = <Surface inScene scene={<mesh/>}><p>One component</p></Surface>
  // @ts-expect-error Custom meshes use explicit JSX rather than a callback receiving an element.
  const oldCallback = <Surface inScene render3D={() => null}><p>One component</p></Surface>
  // @ts-expect-error Hidden sources cannot obtain a size from their page layout.
  const unmeasured = <Surface.HTML hidden={hidden}><p>Measured elsewhere</p></Surface.HTML>
  // @ts-expect-error Scene-only content needs an authored size.
  const sceneSize = <SceneSurface.HTML><p>Panel</p></SceneSurface.HTML>
  void [oldScene, oldCallback, unmeasured, sceneSize]
  return <>
    <article ref={attached.ref}>Native article</article>
    <CaptureContent capture={authored} size={[320,180]}><p>Authored source</p></CaptureContent>
    <Surface inScene={false}><button>Native stateful content</button></Surface>
    <Surface.Root inScene={false}>
      <Surface.HTML part="first"><button>First part</button></Surface.HTML>
      <Surface.HTML part="second" hidden={hidden} size={[320,180]}><button>Second part</button></Surface.HTML>
      <Surface.Scene>
        <Surface.Mesh part="first"><Surface.Anchor name="control"><mesh/></Surface.Anchor></Surface.Mesh>
        <Surface.Mesh part="second" placement="manual" geometry={<planeGeometry args={[320,180]}/>}/>
      </Surface.Scene>
    </Surface.Root>
  </>
}
void RevisionTwoExamples

;<Surface.Root inScene={false}>
  <Surface.HTML as="span" layout="reflow"><span>Inline word</span></Surface.HTML>
  <Surface.Scene><Surface.Mesh part="first" sampledParts={['second']} /></Surface.Scene>
</Surface.Root>
;<SceneSurface.Root><SceneSurface.HTML element={detached} size={[100, 80]} /><SceneSurface.Mesh /></SceneSurface.Root>
// @ts-expect-error An element source and authored children are mutually exclusive.
;<SceneSurface.HTML element={detached} size={[100, 80]}><span>Second source</span></SceneSurface.HTML>
// @ts-expect-error Layout behavior is an explicit policy, not a freeform CSS value.
;<Surface.HTML layout="none"><span>Word</span></Surface.HTML>
declare const captureForTypes: ReturnType<typeof useCaptureHandle>
// @ts-expect-error Source styling belongs on the content; page-only styling has an explicit name.
;<Surface.HTML className="card"><div>Card</div></Surface.HTML>
;<Surface.HTML pageClassName="slot"><div className="card">Card</div></Surface.HTML>
;<CaptureContent capture={captureForTypes} element={detached} size={[100, 80]} />
// @ts-expect-error An authored capture has one content owner.
;<CaptureContent capture={captureForTypes} element={detached} size={[100, 80]}><div /></CaptureContent>

// @ts-expect-error Only the mesh that draws these pixels can report their source coverage.
;<Surface.Mesh presentation="manual" sampledParts={['second']} />
function PageTargetExample() {
  const target = usePageTarget()
  return <>
    <article ref={target.ref} />
    <Surface.Root inScene={false}>
      <Surface.HTML target={target}><input defaultValue="Keeps focus" /></Surface.HTML>
      <Surface.Scene><Surface.Mesh><FrameCompanionExample /></Surface.Mesh></Surface.Scene>
    </Surface.Root>
  </>
}
function FrameCompanionExample() {
  useSurfaceBeforeRender(frame => {
    const drawing: boolean = frame.canvasMayDraw
    const x: number = frame.mesh.matrixWorld.elements[12]!
    const rect: DOMRect = frame.canvas.getBoundingClientRect()
    void [drawing, x, rect]
  })
  return null
}
void PageTargetExample

// @ts-expect-error A supplied handle already owns its diagnostic name.
;<Surface.Root surface={handle} name="duplicate-name" inScene={false}><Surface.HTML><div/></Surface.HTML></Surface.Root>
