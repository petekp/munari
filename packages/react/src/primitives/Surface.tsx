// Surface — one retained HTML instance handed between page and scene.
// Renderer holds and before-render reads own synchronization; React supplies intent.
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type CSSProperties } from 'react'
import { createNativePointerRig, matchMotion, nativeRideStyle, pixelGridSnap, clampScale, zIndexAbove, type NativePointerRig, type SurfaceChrome, type SurfacePartId } from '@munari/core'
import { SurfaceRoot as SurfaceController, type SurfaceIdentityProps } from './surface/SurfaceRoot'
import { SurfaceMesh } from './surface/SurfaceMesh'
import { SurfacePart } from './surface/SurfacePart'
import { SurfaceScene as SurfaceSceneBoundary } from './surface/SurfaceScene'
import { SurfaceAnchor } from './surface/SurfaceAnchor'
import { SurfaceLitMaterial } from './surface/surfaceMaterials'
import { SurfaceRootContext, SurfacePartContext, SurfaceTunnelContext, SurfaceHandleContext, DEFAULT_PART } from './surface/surfaceContext'
import { surfaceStoreOf, useSurfaceHandle, type SurfaceHandle } from './surface/surfaceHandle'
import { surfaceViewPresentation, type SurfaceStatus, type SurfaceViewPresentation, type SurfaceViewDestination } from './surface/surfaceStatus'
import { useSurfaceDriver as useSurfaceDriverBinding, useSurfaceStoreOf } from './surface/useSurfaceDriver'
import { type SurfaceSize, type SurfaceSourceRuntime, type SurfaceResolution, type SurfacePartPublication } from './surface/surfaceSourceRuntime'
import { useLatest } from './useLatest'
import { usePageTargetAttachment, type PageTarget } from './pageTarget'
import { useSurfaceSupport } from './surface/surfaceSupport'
import { surfaceChromeElement } from './surface/surfaceChromeElement'
import { validateSurfaceSize } from './surface/surfaceSize'
import { watchSurfacePlacement } from './surface/surfacePlacement'
import { claimSourcePointer, releaseSourcePointer } from './surface/surfacePointerOwnership'
import { registerHostSpace, hostSpace, markerSpace, boxInHostSpace, hostSpaceScale, hostSpaceUpright } from './surface/surfaceHostSpace'
import { createSurfacePageClip } from './surface/surfacePageClip'
import { insertRetained, moveRetained } from './retainedMove'
import { applyCopyScrolls } from './elementCapture'
import { placeholderCopy, snapshotPageContent as snapshot, sourceNeedsLiveNode, unsupportedSnapshot } from './surface/surfacePageSnapshot'
import { readSurfaceDevicePixelRatio } from './surface/surfaceDevicePixelRatio'

function SceneContribution({ scene }: { scene: ReactNode }) {
  const root = use(SurfaceRootContext)!
  const part = use(SurfacePartContext)
  const mounted = useSyncExternalStore(root.store.subscribePresence, root.store.canvasMounted, () => false)
  const [key] = useState(() => `surface-content-${Math.random()}`)
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
    // The slot's size in the block's own px, never its rect: a turned block
    // inflates every rect it reports, and a Surface sized from one would ask
    // for a texture bigger than the content it is drawing.
    const read=()=>{const space=markerSpace(marker);const box=space&&boxInHostSpace(pageContent() ?? page, space);if(!box)return;const w=box.width,h=box.height;if(last.current?.[0]!==w||last.current[1]!==h){last.current=[w,h];setMeasuredSize([w,h])}root.host?.invalidate()}
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
  onPresentationChange?: (presentation: SurfaceViewPresentation) => void
  onMotionComplete?: (destination: SurfaceViewDestination) => void
  /**
   * Fired when content freezes on entering the scene or thaws on returning to
   * the page. CSS/WAAPI motion freezes automatically; stop custom rAF/timers/video
   * here. Never fires when `live` is set (`useFreezeSurface` reads the same state).
   */
  onFreezeChange?: (frozen: boolean) => void
  onReady?: () => void
  onError?: (error: Error) => void
}

export type SurfaceRootProps = SurfaceControls & SurfaceIdentityProps & {
  inScene: boolean
  canvasId?: string
  children: ReactNode
}
const SurfaceContentContext = createContext<{
  handle: SurfaceHandle
  canEnter: boolean
  reportSupport(part: SurfacePartId, reason: string | null | undefined): void
} | null>(null)

function SurfaceRoot({ inScene, surface, canvasId, name, children, ...controls }: SurfaceRootProps) {
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
  const callbacks = useViewCallbacks(controls)
  const context = useMemo(() => ({ handle, canEnter, reportSupport }), [handle, canEnter, reportSupport])
  return <SurfaceContentContext value={context}>
    <SurfaceController surface={handle} canvasId={canvasId} renderIn={canEnter ? 'canvas' : 'page'} authorIntent={{ requestedInScene: inScene, reason }} {...controls} {...callbacks}>
      {children}
    </SurfaceController>
  </SurfaceContentContext>
}

export type SurfaceHTMLProps = {
  children: ReactNode
  part?: SurfacePartId
  resolution?: SurfaceResolution
  /**
   * Follow unsolicited DOM/CSS changes — an animation, clock, video, or external
   * prop update after mount. Without `live`, both engines follow user input,
   * layout, fonts, images, transition ends, and `useSurfaceRefresh()`, and
   * freeze CSS/Web Animations while in the scene (see `onFreezeChange`). With
   * `live`, HTML-in-canvas accepts every compositor paint and snapDOM re-captures
   * at a paced rate. Default `false`.
   */
  live?: boolean
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
// Chrome's renderer crashes when `moveBefore` puts two fixed-position
// elements, such as these parked capture canvases, inside an absolutely
// positioned size container and a font face arrives in the same task;
// `insertBefore` does not crash (platform.md #35). The insert
// restarts the CSS animations of whatever the host holds, so the caller puts
// the held copy back at the live node's pose.
function dockCaptureHost(host: HTMLElement, dock: HTMLElement): boolean {
  if (host.parentElement === dock) return false
  insertRetained(host, dock)
  return true
}

function SurfaceHTML({ children, part: partId = DEFAULT_PART, size, resolution, live, onChrome, hidden, pageClassName, pageStyle, target, as: Tag = 'div', layout = 'preserve' }: SurfaceHTMLProps) {
  if (size) validateSurfaceSize(size)
  const root = use(SurfaceContentContext)
  const renderingRoot = use(SurfaceRootContext)
  if (!root) throw new Error('Surface.HTML needs a Surface.Root.')
  if (renderingRoot?.wiring === 'canvas') throw new Error('Surface.HTML belongs in the page tree. Use SceneSurface.HTML for scene-only content.')
  const handle = root.handle
  const store = surfaceStoreOf(handle)
  useLayoutEffect(() => {
    if (renderingRoot?.controllerActive) return store.declarePresentation('page')
  }, [store, renderingRoot?.controllerActive])
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
  const desired = root.canEnter && !reason
  const pageRef = useLatest(page)
  const ownRuntime = matchingRuntime(publication, captureRoot)
  const placeholder = useRef<HTMLElement | null>(null)
  // What the capture root already holds, so an unchanged rebuild is dropped
  // before it reaches the source (`snapshot`).
  const heldKey = useRef<string | null>(null)
  const refreshContentRef = useRef<(() => void) | null>(null)
  const refreshContent = useCallback(() => refreshContentRef.current?.(), [])
  const pageDensityKey = -1 // Scene LOD keys are nonnegative; the retained page has one owner.
  const [warmOwner] = useState(() => Symbol())
  const warmRig = useRef<NativePointerRig | null>(null)
  // Keyed on the SOURCE, which owns the host: a new source means a new host,
  // and the rig, the clip and the pointer claim are all built on that host.
  const warmSource = useRef<SurfaceSourceRuntime['source'] | null>(null)
  const warmClip = useRef<ReturnType<typeof createSurfacePageClip> | null>(null)

  const parkWarmRig = useCallback(() => {
    warmRig.current?.park()
    warmClip.current?.restore()
    // Pair for the `setHostPainted(true)` the ride writes. The rig restores
    // only what it wrote, and visibility is no longer one of those.
    warmSource.current?.setHostPainted(false)
    releaseSourcePointer(warmSource.current?.host ?? null, warmOwner)
  }, [warmOwner])
  const returnToHolder = useCallback((holder: HTMLElement) => {
    parkWarmRig()
    holder.inert = false; holder.style.visibility = ''; holder.removeAttribute('aria-hidden')
    if (liveRoot && liveRoot.parentElement !== holder && (holder.isConnected || liveRoot.isConnected)) moveRetained(liveRoot, holder)
    placeholder.current?.remove(); placeholder.current = null
  }, [liveRoot, parkWarmRig])
  const updateWarmRig = (holder:HTMLElement,runtime:SurfaceSourceRuntime|null,captured:boolean,captureElement:HTMLElement) => {
    // The ride stands in for the page copy, so it rides only while that copy is
    // painted. An app that hides the copy itself (Genie's docked windows) would
    // otherwise see the live content flash at the copy's box until the scene draws.
    if (captured && holder.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && store.holdsPage() && runtime) {
      const sourceHost = runtime.source.host
      if (warmSource.current !== runtime.source) {
        parkWarmRig()
        warmRig.current = createNativePointerRig(sourceHost, captureElement, holder)
        warmSource.current = runtime.source
        warmClip.current = createSurfacePageClip(sourceHost, holder)
      }
      const space=hostSpace(sourceHost)
      const slot=space&&boxInHostSpace(pageContent() ?? holder, space)
      if(!space||!slot){parkWarmRig();return}
      const [w, h] = runtime.size()
      // The block's own px magnified onto the screen. A turned block changes
      // where its content is drawn, never how big — so the texture is asked
      // for a size along the block's axes, and the host is stood on a box
      // stated in the block's coordinates, which the block then turns.
      const [spaceX,spaceY]=hostSpaceScale(space)
      const mx=slot.width*spaceX/w,my=slot.height*spaceY/h,dpr=readSurfaceDevicePixelRatio()
      if(resolution===undefined||resolution==='auto')runtime.proposeRaster(pageDensityKey,[clampScale(dpr*mx,w,1),clampScale(dpr*my,1,h)])
      let left=slot.x,top=slot.y,drawW=slot.width,drawH=slot.height
      const [density,densityY]=runtime.source.rasterScale()
      // The store's own count, never `w * density`: the two differ by a
      // whole texel whenever the box carries a fraction (`PixelGridInput`).
      const texelsX=runtime.source.canvas.width,texelsY=runtime.source.canvas.height
      // The grid belongs to the screen, so only a block square to it has
      // texels to land on; content a block turns crosses them at an angle.
      if(hostSpaceUpright(space)&&Math.abs(w*density-drawW*spaceX*dpr)<=1&&Math.abs(h*densityY-drawH*spaceY*dpr)<=1){
        const cx=space.e+space.a*(left+drawW/2),cy=space.f+space.d*(top+drawH/2)
        const a=pixelGridSnap({x:(cx-innerWidth/2)/mx,y:0,width:w,height:h,mag:mx,viewW:innerWidth,viewH:innerHeight,dpr,density,texelsX,texelsY})
        const b=pixelGridSnap({x:0,y:(innerHeight/2-cy)/my,width:w,height:h,mag:my,viewW:innerWidth,viewH:innerHeight,dpr,density:densityY,texelsX,texelsY})
        const snappedW=drawW*a.sx,snappedH=drawH*b.sy
        left+=drawW/2+a.dx*mx/spaceX-snappedW/2;top+=drawH/2-b.dy*my/spaceY-snappedH/2
        drawW=snappedW;drawH=snappedH
      }
      claimSourcePointer(sourceHost, warmOwner, parkWarmRig)
      warmRig.current?.ride(nativeRideStyle(`matrix(${drawW / w},0,0,${drawH / h},${left},${top})`, zIndexAbove(holder)))
      // The host shows its own pixels only while it rides: the captured
      // bitmap carries native selection and caret, which an inert DOM clone
      // cannot. Which property hides a host without killing its capture is
      // the engine's to know, so it is asked rather than written here.
      runtime.source.setHostPainted(true)
      warmClip.current?.apply()
    } else { parkWarmRig(); runtime?.proposeTier(pageDensityKey,null) }
  }
  const move = () => {
    const holder = pageRef.current
    if (!holder || !captureRoot || !liveRoot) return
    // Two different moments ask for the live node. The crossing itself takes
    // it unconditionally — the page is releasing, so nothing is left to stand
    // in for it. Ahead of the crossing, while the page is still the one
    // showing, it is taken only for what a copy cannot carry
    // (`sourceNeedsLiveNode`): standing the real node over the page copy is a
    // substitution, and a substitution the user has no reason to want is one
    // more thing that can be wrong.
    const warm = store.holdsPage()
    const captured = store.canPrepareCanvas() &&
      (!warm || (desired && !unsupportedSnapshot(liveRoot) && sourceNeedsLiveNode(liveRoot))) &&
      ownRuntime !== null
    captureRoot.inert = !captured
    if (captured) captureRoot.removeAttribute('aria-hidden')
    else captureRoot.setAttribute('aria-hidden', 'true')
    if (captured && liveRoot.parentElement !== captureRoot && captureRoot.isConnected) {
      const copy = placeholderCopy(liveRoot)
      holder.append(copy); matchMotion(liveRoot, copy); placeholder.current = copy
      for (const node of [...captureRoot.children]) if (node !== liveRoot) node.remove()
      moveRetained(liveRoot, captureRoot)
      // Explicit, not left to the source's own observer: a source that is
      // not live follows only what the user did to the content, and the
      // request that lifts a Surface usually comes from outside it. The
      // content it is about to show is the live node that just moved in.
      ownRuntime?.source.repaint()
    } else if (!captured && liveRoot.parentElement !== holder) {
      returnToHolder(holder)
      const held = snapshot(liveRoot)
      captureRoot.replaceChildren(held.node); applyCopyScrolls(held.scrolls); matchMotion(liveRoot, held.node); heldKey.current = held.key
    }
    updateWarmRig(holder,ownRuntime,captured,captureRoot)
  }
  const moveRef = useLatest(move)
  const sourceHost=ownRuntime?.source.host ?? null
  useLayoutEffect(()=>{
    if(!sourceHost||!dock||!marker)return
    // Native events must still reach React's root listener after moving the content.
    const docked = dockCaptureHost(sourceHost, dock)
    const copy = captureRoot?.firstElementChild
    if (docked && liveRoot && liveRoot.parentElement !== captureRoot && copy instanceof HTMLElement) matchMotion(liveRoot, copy)
    return registerHostSpace(sourceHost,marker)
  },[sourceHost,dock,marker,liveRoot,captureRoot])

  // While the page holds, the user acts on the live node and the source
  // sees only the copy. Naming the live node keeps the copy's answer to that
  // input followed on an engine that does not follow changes for free.
  useLayoutEffect(() => {
    if (!ownRuntime || !liveRoot) return
    return ownRuntime.source.hearInput(liveRoot)
  }, [ownRuntime, liveRoot])
  useLayoutEffect(() => { moveRef.current() }, [page, desired, publication, moveRef,liveRoot,captureRoot])
  useLayoutEffect(() => store.subscribeHold(() => moveRef.current()), [store, moveRef])
  // What `sourceNeedsLiveNode` reads changes without mutating the content, so
  // nothing already watching the subtree hears it.
  //
  // Coalesced to a frame, deliberately. `focusout` fires while the document
  // still answers `<body>`, so an immediate answer would park the swap
  // between two controls of the same source and move the node twice for one
  // keystroke — with the caret it exists to protect riding along. A frame
  // later the focus has landed, and a caret reaching the texture one frame
  // after it reaches the page is a frame nobody can see.
  useEffect(() => {
    if (!page) return
    const doc = page.ownerDocument
    const subscriptions = new AbortController()
    let queued = 0
    const recheck = () => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        moveRef.current()
      })
    }
    for (const event of ['focusin', 'focusout', 'selectionchange'] as const)
      doc.addEventListener(event, recheck, { capture: true, signal: subscriptions.signal })
    return () => {
      if (queued) cancelAnimationFrame(queued)
      subscriptions.abort()
    }
  }, [page, moveRef])
  useEffect(() => {
    if (!page || !desired) return
    let stop: (() => void) | null = null
    const sync = () => {
      if (store.holdsPage() && store.canPrepareCanvas()) {
        stop ??= watchSurfacePlacement([pageContent, () => marker], () => moveRef.current(), () => warmClip.current?.read() ?? '')
      } else { stop?.(); stop = null }
    }
    const unsubscribe = store.subscribeWork(sync)
    sync()
    return () => { unsubscribe(); stop?.() }
  }, [page, desired, store, moveRef, pageContent, marker])
  useLayoutEffect(() => {
    if (!page || !liveRoot || !captureRoot) return
    const sync = (force: boolean) => {
      const unsupported = unsupportedSnapshot(liveRoot)
      setReason(unsupported)
      if (liveRoot.parentElement === page) {
        const held = snapshot(liveRoot, unsupported)
        if (!force && held.key === heldKey.current) return
        heldKey.current = held.key
        // Installing the copy is a mutation of the source's own element, so
        // the source hears it and decides for itself whether to capture:
        // the compositor always does, a rasterizing engine only when the
        // content is live or the user just acted on it.
        captureRoot.replaceChildren(held.node)
        applyCopyScrolls(held.scrolls)
        matchMotion(liveRoot, held.node)
      } else if (store.holdsPage() && placeholder.current) {
        const copy = placeholderCopy(liveRoot, unsupported)
        placeholder.current.replaceWith(copy); matchMotion(liveRoot, copy); placeholder.current = copy
      }
    }
    // The key describes the copy installed in the previous capture root. A
    // remount under `<Activity>` builds a new, empty root, so install again.
    heldKey.current = null
    const changed = () => sync(false)
    const refreshed = () => sync(true)
    refreshContentRef.current = refreshed
    changed()
    const observer = new MutationObserver(changed)
    const subscriptions = new AbortController()
    observer.observe(liveRoot, { subtree:true, childList:true, attributes:true, characterData:true })
    for (const event of ['input','change','pointerover','pointerout','focusin','focusout','scroll']) liveRoot.addEventListener(event, changed, {capture:true,signal:subscriptions.signal})
    return () => {
      if (refreshContentRef.current === refreshed) refreshContentRef.current = null
      observer.disconnect()
      subscriptions.abort()
    }
  }, [page, liveRoot, captureRoot, store])
  useLayoutEffect(() => () => {
    const holder = pageRef.current
    if (holder) returnToHolder(holder)
    else parkWarmRig()
  }, [pageRef, returnToHolder, parkWarmRig])


  const content = <>
    <Tag ref={setPage} hidden={hidden} className={pageClassName} style={pageStyle}><Tag ref={setLiveRoot} data-api-live="">{children}</Tag></Tag>
    <Tag ref={setDock} style={{display:'contents',pointerEvents:'none'}}>
      <Tag ref={setMarker} style={{all:'initial',position:'fixed',left:0,top:0,width:100,height:100,visibility:'hidden',pointerEvents:'none'}}/>
    </Tag>
    {renderingRoot?.controllerActive && page && liveRoot && captureRoot && marker && <SurfacePart name={partId} adopt={captureRoot} size={size} resolution={resolution} live={live} onChrome={onChrome} pageContent={pageContent} refreshContent={refreshContent} chromeElement={() => surfaceChromeElement(liveRoot, false)}>
      <PageBinding page={page} marker={marker} pageContent={pageContent} layout={layout} inScene={root.canEnter}/>
    </SurfacePart>}
  </>
  // React inserts and reorders the outer home. The moving boundary is its only
  // child, so keyed siblings never use a moved node as their insertBefore anchor.
  // Both tags change together; attachment cleanup returns the boundary before
  // React removes that home. Keeping this tree also preserves SSR hydration.
  return target ? <Tag style={{display:'contents'}}><Tag ref={setBoundary} style={{display:'contents'}}>{content}</Tag></Tag> : content
}

export interface SurfaceSceneProps { children: ReactNode; surface?: SurfaceHandle }
function SurfaceScene({ children, surface }: SurfaceSceneProps) {
  const root = use(SurfaceRootContext)
  if (root && !root.controllerActive && (!surface || surface === root.handle)) return null
  if (surface) return <SurfaceSceneBoundary surface={surface}>{children}</SurfaceSceneBoundary>
  if (!root) throw new Error('Surface.Scene needs a Surface.Root.')
  return root.wiring === 'canvas'
    ? <SurfaceSceneBoundary>{children}</SurfaceSceneBoundary>
    : <SceneContribution scene={children}/>
}

export type SurfaceProps = SurfaceRootProps & {
  size?: SurfaceSize
  resolution?: SurfaceResolution
  /** See `SurfaceHTMLProps.live`. */
  live?: boolean
}

function BasicSurface({ children, size, resolution, live, ...props }: SurfaceProps) {
  return <SurfaceRoot {...props}>
    <SurfaceHTML size={size} resolution={resolution} live={live}>{children}</SurfaceHTML>
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

function useViewCallbacks(controls: SurfaceControls) {
  const latest = useLatest(controls)
  return useMemo(() => ({
    onPresentationChange: (presentation: import('./surface/surfaceHandle').SurfacePresentation) => latest.current.onPresentationChange?.(surfaceViewPresentation(presentation)),
    onMotionComplete: (destination: import('./surface/surfaceHandle').SurfaceDestination) => latest.current.onMotionComplete?.(destination === 'canvas' ? 'scene' : 'page'),
  }), [latest])
}

export type SceneSurfaceRootProps = SurfaceControls & SurfaceIdentityProps & { children: ReactNode; canvasId?: string }
function SceneSurfaceRoot({ children, name, surface, canvasId, ...controls }: SceneSurfaceRootProps) {
  const own = useSurfaceHandle(name)
  const handle = surface ?? own
  const callbacks = useViewCallbacks(controls)
  return <SurfaceController surface={handle} canvasId={canvasId} renderIn="canvas" authorIntent={{ requestedInScene: true, reason: null }} {...controls} {...callbacks}>
    {children}
  </SurfaceController>
}
export type SceneSurfaceHTMLProps = {
  part?: SurfacePartId; size: SurfaceSize; resolution?: SurfaceResolution
  /** See `SurfaceHTMLProps.live`. */
  live?: boolean
} & ({ children: ReactNode; element?: never } | { element: HTMLElement; children?: never })
function SceneSurfaceHTML({ children, element, part = DEFAULT_PART, ...props }: SceneSurfaceHTMLProps) {
  validateSurfaceSize(props.size)
  return <SurfacePart name={part} source={children} adopt={element} {...props}/>
}
export interface SceneSurfaceProps { children: ReactNode; size: SurfaceSize; name?: string; live?: boolean }
function BasicSceneSurface({ children, size, name, live }: SceneSurfaceProps) {
  return <SceneSurfaceRoot name={name}>
    <SceneSurfaceHTML size={size} live={live}>{children}</SceneSurfaceHTML>
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

function useRequiredSurfaceStore(hook: string, surface?: SurfaceHandle) {
  const store = useSurfaceStoreOf(surface)
  if (!store) throw new Error(`${hook} needs a Surface handle or an enclosing Surface.`)
  return store
}

/** Request fresh captures from the enclosing Surface, or from the given handle. */
export function useSurfaceRefresh(surface?: SurfaceHandle): () => void {
  return useRequiredSurfaceStore('useSurfaceRefresh', surface).refresh
}

export function useSurfaceStatus(surface?: SurfaceHandle): SurfaceStatus {
  const store = useRequiredSurfaceStore('useSurfaceStatus', surface)
  const browserSupported = useSurfaceSupport()
  const snapshot = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus)
  return useMemo(() => ({ ...snapshot, supported: browserSupported && snapshot.supported }), [snapshot, browserSupported])
}

/** Is the Surface's content frozen for the scene? The `onFreezeChange` signal, as React state. */
export function useFreezeSurface(surface?: SurfaceHandle): boolean {
  const store = useRequiredSurfaceStore('useFreezeSurface', surface)
  return useSyncExternalStore(store.subscribeFreeze, store.isFrozen, store.isFrozen)
}

export interface SurfaceDriverFrame { readonly dtMs: number; readonly progress: number; readonly target: SurfaceViewDestination }
export type SurfaceDriverStep = (frame: SurfaceDriverFrame) => number
export interface SurfaceMotionFrame { readonly dtMs:number; readonly position:number; readonly target:0|1; readonly scenePresented:boolean }

export function useSurfaceDriver(step: SurfaceDriverStep | null, surface?: SurfaceHandle) {
  useSurfaceDriverBinding(step === null ? null : frame => step({ ...frame, target: frame.target === 'canvas' ? 'scene' : 'page' }), surface)
}

export function useSurfaceMotion(step: (frame: SurfaceMotionFrame) => number, surface?: SurfaceHandle) {
  const store = useRequiredSurfaceStore('useSurfaceMotion', surface)
  useSurfaceDriver(frame => step({ dtMs:frame.dtMs, position:frame.progress, target:frame.target === 'scene' ? 1 : 0, scenePresented:store.getStatus().presentation === 'scene' }), surface)
  return useMemo(()=>({get:()=>store.motionProgress()}),[store])
}
