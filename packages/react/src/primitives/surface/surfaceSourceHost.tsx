// The source host — one part's live DOM, from React content to a texture.
//
// The law: the source never exists without its content. The capture
// container is created and FILLED in the same commit that arms the capture
// pipeline, because Chrome will happily paint a bare container in the gap
// between the two — and that paint is a blank card wearing `.ui-root`'s
// opaque background which fires the readiness receipts, since a receipt
// certifies pixels and not the RIGHT pixels. On a warm remount the gap is
// several composited frames wide: the crossing-flash gate photographed six
// white cards over the logo, 2026-08-13.
//
// Content reaches the container by PORTAL, never by a second React root.
// A portal keeps the source in one reconciler, so a provider mounted above
// `SurfaceCanvas` reaches a `<Surface source>` declared deep in an R3F
// scene. The two wirings differ only in who renders the portal: a page-side
// root renders it itself, and a Canvas-side root hands it outward to the
// host, because the R3F reconciler cannot render react-dom nodes. A source
// update registers its replacement before releasing the old entry. The
// cleanup-first order removed the focused control for one commit on
// 2026-08-18, so every focus attempt fell back to `<body>`.
//
// Ownership: this component owns the container, the runtime's lifetime, and
// the frame registration. It owns no mesh and no material.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { guardPointerCapture, type SurfaceChrome, type SurfacePartId } from '@munari/core'
import { useLatest } from '../useLatest'
import { createSurfaceFocusLedger, transferSurfaceFocus } from './surfaceFocus'
import {
  SurfaceInstanceContext,
  SurfacePartContext,
  sourceContentKey,
  type SurfacePartValue,
  type SurfaceRootValue,
} from './surfaceContext'
import {
  createSurfaceSourceRuntime,
  type SurfaceResolution,
  type SurfaceSize,
  type SurfaceSourceRuntime,
} from './surfaceSourceRuntime'
import { surfaceChromeElement } from './surfaceChromeElement'
import {
  SurfaceOutwardContent,
  createSurfaceOutwardContentStore,
} from './surfaceOutwardContent'

/** Marks the parked container, for probes and the authoring contract. */
export const SOURCE_HOST_ATTRIBUTE = 'data-munari-source-host'
/** Marks which copy of the source tree an instance root is. */
export const INSTANCE_ATTRIBUTE = 'data-munari-instance'
/** The Surface this container captures for, when it was given a name. */
export const SURFACE_NAME_ATTRIBUTE = 'data-munari-surface'
/** Which part of a multi-part Surface this container is. */
export const SURFACE_PART_ATTRIBUTE = 'data-munari-part'

const DEFAULT_SIZE: SurfaceSize = [640, 480]

export interface SurfaceSourceHostProps {
  root: SurfaceRootValue
  id: SurfacePartId
  /** React content to render into a Munari-owned container. */
  source?: React.ReactNode
  /** A detached element Munari takes ownership of instead. */
  adopt?: HTMLElement
  /** Authored source size. Without one the DOM presentation measures it. */
  size?: SurfaceSize
  resolution?: SurfaceResolution
  mirrorU?: boolean
  paint?: 'auto' | 'always'
  onFocusWithinChange?: (focused: boolean) => void
  onChrome?: (chrome: SurfaceChrome) => void
  children?: React.ReactNode
}

export function SurfaceSourceHost({
  root,
  id,
  source,
  adopt,
  size,
  resolution = 'auto',
  mirrorU = false,
  paint = 'auto',
  onFocusWithinChange,
  onChrome,
  children,
}: SurfaceSourceHostProps) {
  const [runtime, setRuntime] = useState<SurfaceSourceRuntime | null>(null)
  const [pageRoot, setPageRoot] = useState<HTMLElement | null>(null)
  const outwardContent = useMemo(createSurfaceOutwardContentStore, [])
  const store = root.store
  const [measured, setMeasured] = useState<SurfaceSize | null>(null)
  const onFocusWithinRef = useLatest(onFocusWithinChange)
  const onChromeRef = useLatest(onChrome)

  // Authored size wins; a DOM presentation measures the rest. The default
  // exists so a resident Surface with neither still has a real box to paint
  // in — a container measuring zero draws an empty rectangle, with clean
  // paints and no error anywhere (docs/platform.md).
  const effectiveSize: SurfaceSize = size ?? measured ?? DEFAULT_SIZE

  // The container is built HERE, per source lifetime, not hoisted into a
  // memo. A hoisted node outlives a teardown, and the parked canvas that
  // owned it is gone by the time the next mount hands it over — adoption
  // refuses a parented node, so the remount throws inside r3f's CanvasImpl
  // and takes the GL context with it.
  const [container] = useState<HTMLElement | null>(() =>
    adopt ? null : createCaptureContainer(),
  )
  const captureRoot = adopt ?? container

  const reportMeasured = root.reportMeasuredSize
  useEffect(() => {
    reportMeasured(id, measured)
  }, [reportMeasured, id, measured])

  // The container says which Surface and which part it captures for. A page
  // holds many parked containers and they are otherwise indistinguishable,
  // so a probe — or a developer in the elements panel — has no way to tell
  // one panel's source from another's.
  const surfaceName = root.name
  useLayoutEffect(() => {
    if (!captureRoot) return
    if (surfaceName !== undefined) captureRoot.setAttribute(SURFACE_NAME_ATTRIBUTE, surfaceName)
    captureRoot.setAttribute(SURFACE_PART_ATTRIBUTE, String(id))
  }, [captureRoot, surfaceName, id])

  // Everything the creation effect reads but must not re-run for.
  const sizeRef = useLatest(effectiveSize)
  const resolutionRef = useLatest(resolution)
  const mirrorURef = useLatest(mirrorU)
  const paintRef = useLatest(paint)

  // Creating the source is a TEARDOWN: it destroys the live DOM subtree and
  // everything alive in it — focus, form values, selection, scroll. So the
  // dependency list is one entry wide on purpose. Size, resolution,
  // mirroring, and paint policy are all handled in place below; a prop
  // belongs here only if changing it means "this is different content now",
  // which for a source is only the identity of the element being captured.
  useLayoutEffect(() => {
    if (!captureRoot) return
    let created: SurfaceSourceRuntime
    try {
      created = createSurfaceSourceRuntime({
        label: root.name,
        content: captureRoot,
        size: sizeRef.current,
        resolution: resolutionRef.current,
        mirrorU: mirrorURef.current,
        paint: paintRef.current,
        pixelRatio: window.devicePixelRatio,
        onError: (error) => root.store.reportError(error),
        onChrome: (chrome) => onChromeRef.current?.(chrome),
        chromeElement: () => surfaceChromeElement(captureRoot, adopt !== undefined),
      })
    } catch (error) {
      // A browser without the trial is a first-class answer, not a crash:
      // the DOM presentation stays visible and `presentedView` never leaves
      // `dom`. Throwing here would unmount the whole R3F tree instead.
      root.store.reportError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    setRuntime(created)
    // The source was replaced: every presenter's proof is void and readiness
    // starts a new lifetime, but the presenters themselves remain.
    root.store.replaceSource()

    return () => {
      setRuntime((current) => (current === created ? null : current))
      created.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRoot])

  // Before paint, not after. `drawElementImage` rasterizes the host at its
  // own layout box, so the declared size IS the size of the next capture.
  // From a passive effect a resize reaches the DOM one paint too late and
  // every capture during a drag is one step behind the geometry it is
  // stretched over — the controls on a panel's face slide against the
  // hardware standing on them.
  const [sourceWidth, sourceHeight] = effectiveSize
  useLayoutEffect(() => {
    if (captureRoot) {
      captureRoot.style.width = `${sourceWidth}px`
      captureRoot.style.height = `${sourceHeight}px`
    }
    runtime?.setSize([sourceWidth, sourceHeight])
  }, [captureRoot, runtime, sourceWidth, sourceHeight])
  useEffect(() => {
    runtime?.setResolution(resolution)
  }, [runtime, resolution])
  useEffect(() => {
    runtime?.setMirrorU(mirrorU)
  }, [runtime, mirrorU])
  useEffect(() => {
    runtime?.setPaint(paint)
  }, [runtime, paint])

  // Capture advances from the host's single frame callback. A demand Canvas
  // is held awake only while the source actually has work — a settling box,
  // a fresh paint, a trailing upload — which is what keeps thirty-three
  // quiescent panels at zero paints per second.
  const host = root.host
  useEffect(() => {
    if (!host || !runtime) return
    let claim: (() => void) | null = null
    const unsubscribePaint = runtime.subscribePaint(() => {
      if (!claim) claim = host.claimWork()
      host.invalidate()
    })
    const release = host.registerTick(() => {
      const working = runtime.frame()
      if (working) {
        if (!claim) claim = host.claimWork()
        host.invalidate()
      } else if (claim) {
        claim()
        claim = null
      }
    })
    return () => {
      unsubscribePaint()
      release()
      claim?.()
    }
  }, [host, runtime])

  const part = useMemo<SurfacePartValue>(
    () => ({
      id,
      runtime,
      size: [sourceWidth, sourceHeight],
      captureRoot,
      pageRoot,
      setPageRoot,
      setMeasuredSize: setMeasured,
    }),
    [id, runtime, sourceWidth, sourceHeight, captureRoot, pageRoot],
  )

  // One logical focus over two DOM copies, and a transfer when the hold
  // moves. Subscribed from a LAYOUT effect so this listener is registered
  // before <Surface.DOM>'s passive one: that is the listener that sets
  // `inert`, and `inert` blurs its subtree, so reading the focused element
  // after it has run finds `<body>`.
  useEffect(() => {
    const ledger = createSurfaceFocusLedger((focused) => onFocusWithinRef.current?.(focused))
    const watch = (element: HTMLElement | null, instance: 'page' | 'source') => {
      if (!element) return () => {}
      const focusIn = () => ledger.report(instance, true)
      const focusOut = () => ledger.report(instance, false)
      element.addEventListener('focusin', focusIn)
      element.addEventListener('focusout', focusOut)
      return () => {
        element.removeEventListener('focusin', focusIn)
        element.removeEventListener('focusout', focusOut)
      }
    }
    const stopPage = watch(pageRoot, 'page')
    const stopSource = watch(captureRoot, 'source')
    return () => {
      stopPage()
      stopSource()
      ledger.dispose()
    }
  }, [pageRoot, captureRoot, onFocusWithinRef])

  const exclusive = root.exclusive
  useLayoutEffect(() => {
    if (!exclusive || !pageRoot || !captureRoot) return
    let held = store.holdsPage()
    return store.subscribeHold(() => {
      const next = store.holdsPage()
      if (next === held) return
      held = next
      transferSurfaceFocus(next ? captureRoot : pageRoot, next ? pageRoot : captureRoot)
    })
  }, [exclusive, pageRoot, captureRoot, store])

  // A Twin has two DOM instances but one accessibility instance. Its page
  // copy owns input and accessibility; the parked source exists only to
  // supply pixels. Resident and exclusive sources keep their ordinary
  // behavior because no simultaneous page copy represents them.
  useEffect(() => {
    if (!captureRoot || root.exclusive || !pageRoot) return
    const previousInert = captureRoot.inert
    const previousAriaHidden = captureRoot.getAttribute('aria-hidden')
    captureRoot.inert = true
    captureRoot.setAttribute('aria-hidden', 'true')
    return () => {
      captureRoot.inert = previousInert
      if (previousAriaHidden === null) captureRoot.removeAttribute('aria-hidden')
      else captureRoot.setAttribute('aria-hidden', previousAriaHidden)
    }
  }, [captureRoot, root.exclusive, pageRoot])

  // Declared parts are the all-or-none set the store's gates read. Declared
  // here because both roads lead through this component: the single-source
  // root and <Surface.Part> each render one source host per part.
  useEffect(() => store.expectPart(id), [store, id])

  // Published to the STORE as well as the context. A presenter reached
  // through separated wiring holds only the handle — it has no ancestor
  // that ever saw this source, so context alone would leave it blank.
  useEffect(() => {
    store.publishPart(id, {
      id,
      runtime,
      size: [sourceWidth, sourceHeight],
      captureRoot,
      pageRoot,
    })
    return () => store.publishPart(id, null)
  }, [store, id, runtime, sourceWidth, sourceHeight, captureRoot, pageRoot])

  // Content reaches the container by whichever door this wiring has. Both
  // render the SAME element into the SAME container; only the reconciler
  // that owns the commit differs.
  const outward = root.wiring === 'canvas'
  // Keyed by the ROOT INSTANCE, not the name. The registry replaces by key,
  // so two unnamed Surfaces sharing a Canvas would publish their sources
  // under one entry and the second commit would take the first one's
  // content away — a panel that mounts, paints once, and goes blank.
  const contentKey = sourceContentKey(root.instanceId, id)
  const wrapped =
    source === undefined ? null : (
      <SurfaceInstanceContext value="source">{source}</SurfaceInstanceContext>
    )
  const hasOutwardContent = source !== undefined
  const outwardElement = useMemo(
    () => <SurfaceOutwardContent store={outwardContent} />,
    [outwardContent],
  )

  // Publish the newest child before the browser paints. The portal-side
  // subscriber reconciles this node inside one stable component, which
  // preserves DOM identity, focus, selection, form state, and scroll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (outward) outwardContent.publish(wrapped)
  })

  // Register once per source identity. Content changes travel through the
  // store above and do not tear this entry down.
  useLayoutEffect(() => {
    if (!outward || !host || !captureRoot || !hasOutwardContent) return
    return host.registerSource({
      key: contentKey,
      container: captureRoot,
      content: outwardElement,
    })
  }, [outward, host, captureRoot, hasOutwardContent, contentKey, outwardElement])

  return (
    <SurfacePartContext value={part}>
      {!outward && wrapped !== null && captureRoot
        ? createPortal(wrapped, captureRoot, contentKey)
        : null}
      {children}
    </SurfacePartContext>
  )
}

function createCaptureContainer(): HTMLElement {
  const node = document.createElement('div')
  node.className = 'ui-root'
  node.setAttribute(SOURCE_HOST_ATTRIBUTE, '')
  node.setAttribute(INSTANCE_ATTRIBUTE, 'source')
  // Declare the size rather than let layout find it. `drawElementImage`
  // rasterizes an element at its own layout box, and a container whose
  // children are `position: fixed` — every portaled layer — contributes
  // nothing to its parent's height. An undeclared container measures zero
  // and draws an empty rectangle, with clean paints and no error anywhere.
  node.style.width = `${DEFAULT_SIZE[0]}px`
  node.style.height = `${DEFAULT_SIZE[1]}px`
  // Parked matter must never hold the real pointer. A drag consumer inside
  // (react-resizable-panels calls `setPointerCapture` per move) would
  // otherwise capture the actual mouse, and every trusted pointer event
  // retargets to the parked element: the canvas goes silent mid-gesture.
  guardPointerCapture(node)
  return node
}
