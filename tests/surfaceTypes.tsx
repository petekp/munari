// Compile-only contracts for the public API; included by the root TypeScript program.
import type { ComponentProps } from 'react'
import {
  Surface, SceneSurface, SurfaceCanvas, createSurface, useSurfaceHandle,
  useSurfaceStatus, useSurfaceDriver, useSurfaceMotion, useFreezeSurface, useSurfaceProgress, useSurfaceSupport, supportsSurfaces,
  useElementCapture, CaptureContent, useCaptureHandle, usePageTarget, useSurfaceBeforeRender,
  type SurfaceHandle, type SurfacePresentation, type SurfaceDestination, type SurfaceProps,
} from '@petepetrash/munari'
import { FrameSurface, type FrameSource, type PresentationRequirement } from '@petepetrash/munari/advanced'

declare const frame: FrameSource
declare const presentation: PresentationRequirement
declare const handle: SurfaceHandle
declare const detached: HTMLElement
declare const canvas: HTMLCanvasElement
const geometry = <planeGeometry args={[1,1]} />

;<SurfaceCanvas id="example" />
;<Surface inScene={false} canvasId="example" name="card" onPresentationChange={value=>{const hold:SurfacePresentation=value;void hold}} onMotionComplete={value=>{const destination:SurfaceDestination=value;void destination}} onFreezeChange={frozen=>{const flag:boolean=frozen;void flag}}><button>One live instance</button></Surface>
;<Surface.Root inScene={false} canvasId="example"><Surface.HTML><button>Page content</button></Surface.HTML></Surface.Root>
;<SceneSurface.Root canvasId="example"><SceneSurface.HTML size={[100,80]}><button>Scene content</button></SceneSurface.HTML><SceneSurface.Mesh/></SceneSurface.Root>
// @ts-expect-error canvasId identifies a host; it does not take a canvas element.
;<Surface inScene={false} canvasId={document.createElement('canvas')}><button>Wrong value</button></Surface>
;<FrameSurface frame={frame} width={10} height={10} onFrameDrawn={receipt=>void receipt.frame.generation} presentation={presentation} onPresented={receipt=>void receipt.presentationRevision}>{geometry}</FrameSurface>
// @ts-expect-error The frame adapter owns its draw fence.
;<FrameSurface frame={frame} onBeforeRender={()=>{}}>{geometry}</FrameSurface>
// @ts-expect-error A basic Surface contains HTML, rather than a separate source prop.
;<Surface inScene={false} source={<div/>}><div/></Surface>
// @ts-expect-error Renderer intent is a boolean, not a destination string.
;<Surface inScene="scene"><div/></Surface>
// @ts-expect-error Custom materials belong on the scene mesh.
;<Surface inScene material="none"><div/></Surface>
// @ts-expect-error The high-level Surface requires its boolean intent.
;<Surface><div/></Surface>
// @ts-expect-error One owner supplies the identity.
;<Surface inScene surface={handle} name="duplicate"><div/></Surface>
// @ts-expect-error A SceneSurface needs explicit dimensions.
;<SceneSurface><div/></SceneSurface>
// @ts-expect-error Size has two dimensions.
;<SceneSurface size={[10,20,30]}><div/></SceneSurface>
// @ts-expect-error Frame input has its own adapter.
;<Surface inScene frame={frame}><div/></Surface>

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
  const frozen:boolean=useFreezeSurface(own);void frozen
  const hold: SurfacePresentation=state.presentation
  const raw:number=useSurfaceProgress(own).get()
  const eased:number=useSurfaceProgress(own).eased()
  useSurfaceDriver(({target,progress})=>target==='scene'?progress:0,own)
  useSurfaceDriver(null,own)
  const motion=useSurfaceMotion(({position,target,scenePresented,dtMs})=>scenePresented?Math.min(target,position+dtMs/1000):0,own)
  const position:number=motion.get()
  void useSurfaceSupport();void supportsSurfaces();void [hold,raw,eased,position]
  // @ts-expect-error Renderer mount duty is private.
  void state.isWebGLMounted
  // @ts-expect-error Canvas is not a public destination.
  const oldDestination:SurfaceDestination='canvas'
  void oldDestination
  return <Surface surface={own} inScene={false}><div/></Surface>
}
void Observations

function ContentCompositionExamples() {
  const attached = useElementCapture()
  const following = useElementCapture({ live: true, exclude: '.preview' })
  void following
  const authored = useCaptureHandle()
  const hidden = Math.random() > 0.5
  // @ts-expect-error A callback ref is returned by this hook; a plain ref object is not an options object.
  useElementCapture({ current: null })
  // @ts-expect-error Hidden sources cannot obtain a size from their page layout.
  const unmeasured = <Surface.HTML hidden={hidden}><p>Measured elsewhere</p></Surface.HTML>
  // @ts-expect-error Scene-only content needs an authored size.
  const sceneSize = <SceneSurface.HTML><p>Panel</p></SceneSurface.HTML>
  void [unmeasured, sceneSize]
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
void ContentCompositionExamples

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

const customProducer = {
  canvas,
  format: { colorSpace: 'srgb', premultiplyAlpha: false },
  currentFrame: () => ({ sourceId: 1, generation: 0 }),
  subscribe: () => () => {},
} satisfies FrameSource
;<FrameSurface frame={customProducer}>{geometry}</FrameSurface>

// @ts-expect-error FrameSurface owns the callback that issues draw receipts.
;<FrameSurface frame={frame} onAfterRender={()=>{}}>{geometry}</FrameSurface>
// @ts-expect-error Surface.Mesh owns preparation before a draw.
;<Surface.Mesh onBeforeRender={()=>{}} />
// @ts-expect-error Surface.Mesh owns evidence after a draw.
;<Surface.Mesh onAfterRender={()=>{}} />
// @ts-expect-error A shared canvas cannot hide all Surfaces through caller opacity.
;<SurfaceCanvas style={{ opacity: 0 }} />
// @ts-expect-error A shared canvas owns visibility.
;<SurfaceCanvas style={{ visibility: 'hidden' }} />
// @ts-expect-error A shared canvas owns pointer routing.
;<SurfaceCanvas style={{ pointerEvents: 'none' }} />
;<SurfaceCanvas style={{ width: '100%', height: 300 }} />
// @ts-expect-error Native visibility follows the accepted renderer hold.
;<Surface.HTML pageStyle={{ visibility: 'hidden' }}><div /></Surface.HTML>
// @ts-expect-error Native input follows the accepted renderer hold.
;<Surface.HTML pageStyle={{ pointerEvents: 'none' }}><div /></Surface.HTML>
// @ts-expect-error Page layout is controlled through layout and hidden.
;<Surface.HTML pageStyle={{ display: 'none' }}><div /></Surface.HTML>
;<Surface.HTML pageStyle={{ margin: 12 }}><div /></Surface.HTML>
// @ts-expect-error The handle cannot write renderer intent.
handle.request('scene')
