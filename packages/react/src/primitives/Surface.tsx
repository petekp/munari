// Surface — one retained HTML instance handed between page and scene.
// Renderer holds and before-render reads own synchronization; React supplies intent.
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type CSSProperties } from 'react'
import { createNativePointerRig, nativeRideStyle, pixelGridSnap, clampScale, zIndexAbove, type NativePointerRig, type SurfaceChrome, type SurfacePartId } from '@munari/core'
import { SurfaceRoot as SurfaceController, type SurfaceIdentityProps } from './surface/SurfaceRoot'
import { SurfaceMesh } from './surface/SurfaceMesh'
import { SurfacePart } from './surface/SurfacePart'
import { SurfaceScene as SurfaceSceneBoundary } from './surface/SurfaceScene'
import { SurfaceAnchor } from './surface/SurfaceAnchor'
import { SurfaceLitMaterial } from './surface/surfaceMaterials'
import { SurfaceRootContext, SurfacePartContext, SurfaceTunnelContext, SurfaceHandleContext, DEFAULT_PART } from './surface/surfaceContext'
import { surfaceStoreOf, useSurfaceHandle, type SurfaceHandle, type SurfaceTiming } from './surface/surfaceHandle'
import { surfaceViewPresentation, type SurfaceViewPresentation, type SurfaceViewDestination } from './surface/surfaceStatus'
import { useSurfaceDriver as useSurfaceDriverBinding } from './surface/useSurfaceDriver'
import { type SurfaceSize, type SurfaceSourceRuntime, type SurfaceResolution, type SurfacePartPublication } from './surface/surfaceSourceRuntime'
import { useLatest } from './useLatest'
import { usePageTargetAttachment, type PageTarget } from './pageTarget'
import { useSurfaceSupport } from './surface/surfaceSupport'
import { surfaceChromeElement } from './surface/surfaceChromeElement'
import { validateSurfaceSize } from './surface/surfaceSize'
import { watchSurfacePlacement } from './surface/surfacePlacement'
import { claimSourcePointer, releaseSourcePointer } from './surface/surfacePointerOwnership'
import { registerCanvasSpace, canvasSpace } from './surface/surfaceCanvasSpace'

function unsupportedSnapshot(root:HTMLElement):string|null {
  for(const element of [root,...root.querySelectorAll('*')]) {
    if(['iframe','video','audio','object','embed'].includes(element.localName)||element.localName.includes('-')||element.hasAttribute('is')||element.shadowRoot) {
      return `The single-instance handoff has not validated <${element.localName}>; keep this content native.`
    }
    if(element.hasAttribute('form')||element.getAttributeNames().some(name=>name.startsWith('on')))return 'Explicit form associations and inline DOM handlers remain native.'
    const form = element instanceof HTMLInputElement || element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || element instanceof HTMLFieldSetElement ? element.form : null
    if(form&&!root.contains(form))return 'Keep the form and its controls inside the same Surface.'
    if(element instanceof HTMLInputElement&&element.type==='radio'&&element.name&&!form)return 'Named radio groups without a containing form remain native.'
  }
  return null
}

function snapshot(root: HTMLElement): HTMLElement {
  // Do not instantiate another iframe, media player, or custom element as a placeholder.
  if(unsupportedSnapshot(root))return document.createElement('div')
  // SAFETY: cloning an HTMLElement preserves its element type.
  const copy = root.cloneNode(true) as HTMLElement
  copy.dataset.munariSnapshot = ''
  const originals = [root, ...root.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  originals.forEach((original, index) => {
    const target = copies[index]
    if (!target) return
    target.removeAttribute('id')
    target.removeAttribute('data-api-live')
    target.toggleAttribute('data-hover', original.matches(':hover') || original.hasAttribute('data-hover'))
    target.toggleAttribute('data-active', original.matches(':active') || original.hasAttribute('data-active'))
    target.toggleAttribute('data-focus-visible', original.matches(':focus-visible'))
    if (original instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      target.value = original.value; target.checked = original.checked; target.indeterminate = original.indeterminate
    } else if (original instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) target.value = original.value
    else if (original instanceof HTMLSelectElement && target instanceof HTMLSelectElement) target.selectedIndex = original.selectedIndex
    else if (original instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) {
      target.getContext('2d')?.drawImage(original, 0, 0)
    }
    target.scrollTop = original.scrollTop; target.scrollLeft = original.scrollLeft
  })
  return copy
}

function SceneContribution({ scene }: { scene: ReactNode }) {
  const root = use(SurfaceRootContext)!
  const part = use(SurfacePartContext)
  const mounted = useSyncExternalStore(root.store.subscribePresence, root.store.canvasMounted, () => false)
  const [key] = useState(() => `api-proof-${Math.random()}`)
  useLayoutEffect(() => root.store.declarePresentation('canvas'), [root.store])
  const identity = useMemo(() => ({ handle: root.handle, store: root.store }), [root.handle, root.store])
  const element = <SurfaceHandleContext value={identity}><SurfaceRootContext value={root}><SurfacePartContext value={part}><SurfaceTunnelContext value>{scene}</SurfaceTunnelContext></SurfacePartContext></SurfaceRootContext></SurfaceHandleContext>
  useEffect(() => {
    if (!root.host || !mounted) return
    return root.host.registerPresenter({ key, element })
  })
  return null
}

function PageBinding({page,marker,layout,inScene,pageContent}:{page:HTMLElement;marker:HTMLElement;pageContent:()=>HTMLElement|null;layout:'preserve'|'reflow';inScene:boolean}) {
  const root=use(SurfaceRootContext)!
  const part=use(SurfacePartContext)!
  const last=useRef<readonly[number,number]|null>(null)
  const setPageRoot=part.setPageRoot,setMeasuredSize=part.setMeasuredSize
  useLayoutEffect(()=>{setPageRoot(page);return()=>setPageRoot(null)},[page,setPageRoot])
  useLayoutEffect(()=>{
    const read=()=>{const rect=(pageContent() ?? page).getBoundingClientRect(),space=marker.getBoundingClientRect();if(rect.width<=0||rect.height<=0||space.width<=0||space.height<=0)return;const w=rect.width/(space.width/100),h=rect.height/(space.height/100);if(last.current?.[0]!==w||last.current[1]!==h){last.current=[w,h];setMeasuredSize([w,h])}root.host?.invalidate()}
    read();const observer=new ResizeObserver(read);observer.observe(page)
    let measured:HTMLElement|null=null
    const watch=()=>{const next=pageContent();if(next!==measured){if(measured)observer.unobserve(measured);measured=next;if(measured)observer.observe(measured)}read()}
    watch();const mutations=new MutationObserver(watch);mutations.observe(page,{subtree:true,childList:true})
    const subscriptions = new AbortController()
    window.addEventListener('scroll',read,{capture:true,passive:true,signal:subscriptions.signal});window.addEventListener('resize',read,{passive:true,signal:subscriptions.signal})
    return()=>{observer.disconnect();mutations.disconnect();subscriptions.abort()}
  },[page,marker,setMeasuredSize,root.host,pageContent])
  useEffect(()=>{
    const apply=()=>{const released=!root.store.pagePresents();page.style.visibility=released?'hidden':'';page.style.display=layout==='reflow'&&released&&inScene?'none':'';page.inert=released;if(released)page.setAttribute('aria-hidden','true');else page.removeAttribute('aria-hidden')}
    apply();return root.store.subscribeHold(apply)
  },[page,root.store,layout,inScene])
  return null
}

export interface SurfaceControls {
  timing?: SurfaceTiming
  onPresentationChange?: (presentation: SurfaceViewPresentation) => void
  onMotionComplete?: (destination: SurfaceViewDestination) => void
  onReady?: () => void
  onError?: (error: Error) => void
}

export type SurfaceRootProps = SurfaceControls & SurfaceIdentityProps & {
  inScene: boolean
  canvas?: string
  children: ReactNode
}
const SurfaceContentContext = createContext<{
  handle: SurfaceHandle
  canEnter: boolean
  reportSupport(part: SurfacePartId, reason: string | null | undefined): void
} | null>(null)

function SurfaceRoot({ inScene, surface, canvas, name, children, ...controls }: SurfaceRootProps) {
  const own = useSurfaceHandle(name)
  const handle = surface ?? own
  const browserSupported = useSurfaceSupport()
  const [reasons, setReasons] = useState<ReadonlyMap<SurfacePartId, string | null>>(() => new Map())
  const reportSupport = useCallback((part: SurfacePartId, reason: string | null | undefined) => {
    setReasons(current => {
      if (current.get(part) === reason && (reason !== undefined || !current.has(part))) return current
      const next = new Map(current)
      if (reason === undefined) next.delete(part)
      else next.set(part, reason)
      return next
    })
  }, [])
  const reason = [...reasons.values()].find(value => value !== null) ?? null
  const canEnter = inScene && browserSupported && !reason
  useAuthorIntent(handle, inScene, reason)
  const callbacks = useViewCallbacks(controls)
  const context = useMemo(() => ({ handle, canEnter, reportSupport }), [handle, canEnter, reportSupport])
  return <SurfaceContentContext value={context}>
    <SurfaceController surface={handle} canvas={canvas} renderIn={canEnter ? 'canvas' : 'page'} {...controls} {...callbacks}>
      {children}
    </SurfaceController>
  </SurfaceContentContext>
}

export type SurfaceHTMLProps = {
  children: ReactNode
  part?: SurfacePartId
  resolution?: SurfaceResolution
  paint?: 'auto' | 'always'
  onChrome?: (chrome: SurfaceChrome) => void
  target?: PageTarget
  pageClassName?: string
  /** Use a span for content in a paragraph. The source remains one unbroken box. */
  as?: 'div' | 'span'
  /** Reflow removes the page slot only after a proven canvas draw. */
  layout?: 'preserve' | 'reflow'
  pageStyle?: Omit<CSSProperties, 'visibility' | 'pointerEvents' | 'display'>
} & ({ hidden?: false; size?: SurfaceSize } | { hidden: boolean; size: SurfaceSize })

function matchingRuntime(publication: SurfacePartPublication | null, element: HTMLElement | null): SurfaceSourceRuntime | null {
  return publication?.captureRoot === element ? publication?.runtime ?? null : null
}
function attachCaptureCanvas(canvas: HTMLCanvasElement, dock: HTMLElement) {
  if (canvas.parentElement === dock) return
  if ('moveBefore' in Element.prototype && canvas.isConnected && dock.isConnected) dock.moveBefore(canvas, null)
  else dock.append(canvas)
}

function SurfaceHTML({ children, part: partId = DEFAULT_PART, size, resolution, paint, onChrome, hidden, pageClassName, pageStyle, target, as: Tag = 'div', layout = 'preserve' }: SurfaceHTMLProps) {
  if (size) validateSurfaceSize(size)
  const root = use(SurfaceContentContext)
  const renderingRoot = use(SurfaceRootContext)
  if (!root) throw new Error('Surface.HTML needs a Surface.Root.')
  if (renderingRoot?.wiring === 'canvas') throw new Error('Surface.HTML belongs in the page tree. Use SceneSurface.HTML for scene-only content.')
  const handle = root.handle
  const store = surfaceStoreOf(handle)
  useLayoutEffect(() => store.declarePresentation('page'), [store])
  const [reason, setReason] = useState<string | null>(null)
  const reportSupport = root.reportSupport
  useLayoutEffect(() => {
    reportSupport(partId, reason)
    return () => reportSupport(partId, undefined)
  }, [reportSupport, partId, reason])
  const [captureRoot,setCaptureRoot] = useState<HTMLElement|null>(null)
  const [liveRoot,setLiveRoot] = useState<HTMLElement|null>(null)
  useLayoutEffect(()=>{const element=document.createElement(Tag);element.style.display='block';element.dataset.munariSourceHost='';element.dataset.munariInstance='source';setCaptureRoot(element)},[Tag])
  const [page, setPage] = useState<HTMLElement | null>(null)
  const pageContent = useCallback(() => {
    const content = page?.firstElementChild
    return content instanceof HTMLElement ? surfaceChromeElement(content, false) : page
  }, [page])
  const [boundary, setBoundary] = useState<HTMLElement | null>(null)
  usePageTargetAttachment(target, boundary, page, hidden)
  const [dock,setDock]=useState<HTMLElement|null>(null)
  const [marker,setMarker]=useState<HTMLElement|null>(null)
  const publication = useSyncExternalStore(store.subscribeParts, () => store.part(partId) ?? null, () => null)
  const desired = root.canEnter && !reason && 'moveBefore' in Element.prototype
  const desiredRef = useLatest(desired)
  const pageRef = useLatest(page)
  const ownRuntime = matchingRuntime(publication, captureRoot)
  const runtimeRef = useLatest(ownRuntime)
  const placeholder = useRef<HTMLElement | null>(null)
  const pageDensityKey = -1 // Scene LOD keys are nonnegative; the retained page has one owner.
  const [warmOwner] = useState(() => Symbol())
  const warmRig = useRef<NativePointerRig | null>(null)
  const warmCanvas = useRef<HTMLCanvasElement | null>(null)

  const parkWarmRig = useCallback(() => {
    warmRig.current?.park()
    releaseSourcePointer(warmCanvas.current, warmOwner)
  }, [warmOwner])
  const updateWarmRig = (holder:HTMLElement,runtime:SurfaceSourceRuntime|null,captured:boolean,captureElement:HTMLElement) => {
    if (captured && !holder.hidden && store.holdsPage() && runtime) {
      const sourceCanvas = runtime.source.canvas
      if (warmCanvas.current !== sourceCanvas) {
        parkWarmRig()
        warmRig.current = createNativePointerRig(sourceCanvas, captureElement, holder)
        warmCanvas.current = sourceCanvas
      }
      const rect = (pageContent() ?? holder).getBoundingClientRect()
      const [w, h] = runtime.size()
      const mx=rect.width/w,my=rect.height/h,dpr=window.devicePixelRatio
      if(resolution===undefined||resolution==='auto')runtime.proposeRaster(pageDensityKey,[clampScale(dpr*mx,w,1),clampScale(dpr*my,1,h)])
      let left=rect.left,top=rect.top,drawW=rect.width,drawH=rect.height
      const [density,densityY]=runtime.source.rasterScale()
      if(Math.abs(w*density-rect.width*dpr)<=1&&Math.abs(h*densityY-rect.height*dpr)<=1){
        const a=pixelGridSnap({x:(rect.left+rect.width/2-innerWidth/2)/mx,y:0,width:w,height:h,mag:mx,viewW:innerWidth,viewH:innerHeight,dpr,density})
        const b=pixelGridSnap({x:0,y:(innerHeight/2-rect.top-rect.height/2)/my,width:w,height:h,mag:my,viewW:innerWidth,viewH:innerHeight,dpr,density:densityY})
        drawW*=a.sx;drawH*=b.sy
        left+=rect.width/2+a.dx*mx-drawW/2;top+=rect.height/2-b.dy*my-drawH/2
      }
      const space=canvasSpace(sourceCanvas)
      if(!space){parkWarmRig();return}
      claimSourcePointer(sourceCanvas, warmOwner, () => warmRig.current?.park())
      warmRig.current?.ride({
        ...nativeRideStyle(`matrix(${drawW / w / space.scaleX},0,0,${drawH / h / space.scaleY},${(left-space.left)/space.scaleX},${(top-space.top)/space.scaleY})`, zIndexAbove(holder)),
        // The captured bitmap includes native selection/caret; an inert DOM clone cannot.
        canvasVisibility: 'visible',
      })
    } else { parkWarmRig(); runtime?.proposeTier(pageDensityKey,null) }
  }
  const move = () => {
    const holder = pageRef.current
    const runtime = runtimeRef.current
    if (!holder || !captureRoot || !liveRoot) return
    const captured = store.canPrepareCanvas() && (!store.holdsPage() || (desiredRef.current && !unsupportedSnapshot(liveRoot))) && runtime !== null
    captureRoot.inert = !captured
    if (captured) captureRoot.removeAttribute('aria-hidden')
    else captureRoot.setAttribute('aria-hidden', 'true')
    if (captured && liveRoot.parentElement !== captureRoot && captureRoot.isConnected) {
      const copy = snapshot(liveRoot)
      copy.inert = true; copy.setAttribute('aria-hidden', 'true'); copy.style.visibility = 'hidden'
      holder.append(copy); placeholder.current = copy
      for (const node of [...captureRoot.children]) if (node !== liveRoot) node.remove()
      captureRoot.moveBefore(liveRoot, null)
      runtime?.source.repaint()
    } else if (!captured && liveRoot.parentElement !== holder) {
      parkWarmRig()
      // Ownership has returned before this move; the destination must already accept focus.
      holder.inert=false;holder.style.visibility='';holder.removeAttribute('aria-hidden')
      if (liveRoot.isConnected) holder.moveBefore(liveRoot, null)
      else holder.append(liveRoot)
      placeholder.current?.remove(); placeholder.current = null
      captureRoot.replaceChildren(snapshot(liveRoot))
      runtime?.source.repaint()
    }
    updateWarmRig(holder,runtime,captured,captureRoot)
  }
  const moveRef = useLatest(move)
  const sourceCanvas=ownRuntime?.source.canvas ?? null
  useLayoutEffect(()=>{
    if(!sourceCanvas||!dock||!marker)return
    // The capture supplies pixels, not another page image (platform.md #20).
    sourceCanvas.style.visibility = 'hidden'
    if (captureRoot) captureRoot.style.visibility = 'visible'
    // Native events must still reach React's root listener after moving the content.
    attachCaptureCanvas(sourceCanvas, dock)
    return registerCanvasSpace(sourceCanvas,marker)
  },[sourceCanvas,dock,marker,captureRoot])

  useLayoutEffect(() => { moveRef.current() }, [page, desired, publication, moveRef,liveRoot,captureRoot])
  useLayoutEffect(() => store.subscribeHold(() => moveRef.current()), [store, moveRef])
  useEffect(() => {
    if (!page || !desired) return
    let stop: (() => void) | null = null
    const sync = () => {
      if (store.holdsPage() && store.canPrepareCanvas()) {
        stop ??= watchSurfacePlacement([pageContent, () => marker], () => moveRef.current())
      } else { stop?.(); stop = null }
    }
    const unsubscribe = store.subscribeWork(sync)
    sync()
    return () => { unsubscribe(); stop?.() }
  }, [page, desired, store, moveRef, pageContent, marker])
  useLayoutEffect(() => {
    if (!page || !liveRoot || !captureRoot) return
    const sync = () => {
      setReason('moveBefore' in Element.prototype ? unsupportedSnapshot(liveRoot) : 'This browser cannot preserve DOM state while moving the content.')
      if (liveRoot.parentElement === page) {
        captureRoot.replaceChildren(snapshot(liveRoot))
        runtimeRef.current?.source.repaint()
      } else if (store.holdsPage() && placeholder.current) {
        const copy = snapshot(liveRoot)
        copy.inert = true; copy.setAttribute('aria-hidden', 'true'); copy.style.visibility = 'hidden'
        placeholder.current.replaceWith(copy); placeholder.current = copy
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    const subscriptions = new AbortController()
    observer.observe(liveRoot, { subtree:true, childList:true, attributes:true, characterData:true })
    for (const event of ['input','change','pointerover','pointerout','focusin','focusout','scroll']) liveRoot.addEventListener(event, sync, {capture:true,signal:subscriptions.signal})
    return () => { observer.disconnect(); subscriptions.abort() }
  }, [page, liveRoot, captureRoot, runtimeRef, store])
  useLayoutEffect(() => () => {
    parkWarmRig()
    const holder = pageRef.current
    if (holder && liveRoot?.isConnected && liveRoot.parentElement !== holder) holder.moveBefore(liveRoot, null)
  }, [liveRoot, pageRef, parkWarmRig])


  const content = <>
    <Tag ref={setPage} hidden={hidden} className={pageClassName} style={pageStyle}><Tag ref={setLiveRoot} data-api-live="">{children}</Tag></Tag>
    <Tag ref={setDock} style={{display:'contents',pointerEvents:'none'}}>
      <Tag ref={setMarker} style={{all:'initial',position:'fixed',left:0,top:0,width:100,height:100,visibility:'hidden',pointerEvents:'none'}}/>
    </Tag>
    {page && liveRoot && captureRoot && marker && <SurfacePart name={partId} adopt={captureRoot} size={size} resolution={resolution} paint={paint} onChrome={onChrome} pageContent={pageContent} chromeElement={() => surfaceChromeElement(liveRoot, false)}>
      <PageBinding page={page} marker={marker} pageContent={pageContent} layout={layout} inScene={root.canEnter}/>
    </SurfacePart>}
  </>
  return target ? <Tag ref={setBoundary} style={{display:'contents'}}>{content}</Tag> : content
}

export interface SurfaceSceneProps { children: ReactNode; surface?: SurfaceHandle }
function SurfaceScene({ children, surface }: SurfaceSceneProps) {
  const root = use(SurfaceRootContext)
  if (surface) return <SurfaceSceneBoundary surface={surface}>{children}</SurfaceSceneBoundary>
  if (!root) throw new Error('Surface.Scene needs a Surface.Root.')
  return root.wiring === 'canvas'
    ? <SurfaceSceneBoundary>{children}</SurfaceSceneBoundary>
    : <SceneContribution scene={children}/>
}

export type SurfaceProps = SurfaceRootProps & { size?: SurfaceSize; resolution?: SurfaceResolution }

function BasicSurface({ children, size, resolution, ...props }: SurfaceProps) {
  return <SurfaceRoot {...props}>
    <SurfaceHTML size={size} resolution={resolution}>{children}</SurfaceHTML>
    <SurfaceMesh />
  </SurfaceRoot>
}

export const Surface = Object.assign(BasicSurface, {
  Root: SurfaceRoot,
  HTML: SurfaceHTML,
  Scene: SurfaceScene,
  Mesh: SurfaceMesh,
  Anchor: SurfaceAnchor,
  LitMaterial: SurfaceLitMaterial,
})

function useAuthorIntent(handle: SurfaceHandle, inScene: boolean, reason: string | null) {
  const store = surfaceStoreOf(handle)
  const [owner] = useState(() => Symbol())
  useLayoutEffect(() => { store.setAuthorIntent(owner, inScene, reason) }, [store, owner, inScene, reason])
  useLayoutEffect(() => () => store.clearAuthorIntent(owner), [store, owner])
}

function useViewCallbacks(controls: SurfaceControls) {
  const latest = useLatest(controls)
  return useMemo(() => ({
    onPresentationChange: (presentation: import('./surface/surfaceHandle').SurfacePresentation) => latest.current.onPresentationChange?.(surfaceViewPresentation(presentation)),
    onMotionComplete: (destination: import('./surface/surfaceHandle').SurfaceDestination) => latest.current.onMotionComplete?.(destination === 'canvas' ? 'scene' : 'page'),
  }), [latest])
}

export type SceneSurfaceRootProps = SurfaceControls & SurfaceIdentityProps & { children: ReactNode; canvas?: string }
function SceneSurfaceRoot({ children, name, surface, canvas, ...controls }: SceneSurfaceRootProps) {
  const own = useSurfaceHandle(name)
  const handle = surface ?? own
  useAuthorIntent(handle, true, null)
  const callbacks = useViewCallbacks(controls)
  return <SurfaceController surface={handle} canvas={canvas} renderIn="canvas" {...controls} {...callbacks}>{children}</SurfaceController>
}
export type SceneSurfaceHTMLProps = {
  part?: SurfacePartId; size: SurfaceSize; resolution?: SurfaceResolution; paint?: 'auto' | 'always'
} & ({ children: ReactNode; element?: never } | { element: HTMLElement; children?: never })
function SceneSurfaceHTML({ children, element, part = DEFAULT_PART, ...props }: SceneSurfaceHTMLProps) {
  validateSurfaceSize(props.size)
  return <SurfacePart name={part} source={children} adopt={element} {...props}><CaptureBitmapHidden/></SurfacePart>
}
function CaptureBitmapHidden() {
  const part = use(SurfacePartContext)
  const canvas = part?.runtime?.source.canvas
  const root = part?.captureRoot
  useLayoutEffect(() => {
    if (!canvas || !root) return
    const canvasVisibility = canvas.style.visibility
    const rootVisibility = root.style.visibility
    canvas.style.visibility = 'hidden'
    root.style.visibility = 'visible'
    return () => { canvas.style.visibility = canvasVisibility; root.style.visibility = rootVisibility }
  }, [canvas, root])
  return null
}
export interface SceneSurfaceProps { children: ReactNode; size: SurfaceSize; name?: string; paint?: 'auto' | 'always' }
function BasicSceneSurface({ children, size, name, paint }: SceneSurfaceProps) {
  return <SceneSurfaceRoot name={name}>
    <SceneSurfaceHTML size={size} paint={paint}>{children}</SceneSurfaceHTML>
    <SurfaceMesh scale={[size[0] / size[1], 1, 1]}/>
  </SceneSurfaceRoot>
}
export const SceneSurface = Object.assign(BasicSceneSurface, {
  Root: SceneSurfaceRoot,
  HTML: SceneSurfaceHTML,
  Mesh: SurfaceMesh,
  Scene: SurfaceScene,
  Anchor: SurfaceAnchor,
  LitMaterial: SurfaceLitMaterial,
})

export function useSurfaceStatus(surface?: SurfaceHandle) {
  const context = use(SurfaceHandleContext)
  const store = surface ? surfaceStoreOf(surface) : context?.store
  if (!store) throw new Error('useSurfaceStatus needs a Surface handle or an enclosing Surface.')
  const browserSupported = useSurfaceSupport()
  const snapshot = useSyncExternalStore(
    useMemo(() => store.subscribe.bind(store), [store]),
    useMemo(() => store.getStatus.bind(store), [store]),
    useMemo(() => store.getStatus.bind(store), [store]),
  )
  return useMemo(() => ({ ...snapshot, supported: browserSupported && snapshot.supported }), [snapshot, browserSupported])
}

export interface SurfaceDriverFrame { readonly dtMs: number; readonly progress: number; readonly target: SurfaceViewDestination }
export type SurfaceDriverStep = (frame: SurfaceDriverFrame) => number
export interface SurfaceMotionFrame { readonly dtMs:number; readonly position:number; readonly target:0|1; readonly scenePresented:boolean }

export function useSurfaceDriver(step: SurfaceDriverStep | null, surface?: SurfaceHandle) {
  useSurfaceDriverBinding(step === null ? null : frame => step({ ...frame, target: frame.target === 'canvas' ? 'scene' : 'page' }), surface)
}

export function useSurfaceMotion(step: (frame: SurfaceMotionFrame) => number, surface?: SurfaceHandle) {
  const context = use(SurfaceHandleContext)
  const store = surface ? surfaceStoreOf(surface) : context?.store
  if (!store) throw new Error('useSurfaceMotion needs a Surface handle or an enclosing Surface.')
  useSurfaceDriver(frame => step({ dtMs:frame.dtMs, position:frame.progress, target:frame.target === 'scene' ? 1 : 0, scenePresented:store.getStatus().presentation === 'scene' }), surface)
  return useMemo(()=>({get:()=>store?.motionProgress()??0}),[store])
}
