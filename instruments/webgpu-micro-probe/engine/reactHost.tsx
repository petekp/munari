// Single-reconciler WebGPU React host built directly on @munari/core.
// No Three.js, no @react-three/fiber, no second React reconciler.

import { use, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_TIERS,
  EMPTY_CHROME,
  bridgeHover,
  chromeEquals,
  clampScale,
  clampTiers,
  createDomTextureSource,
  crossingAtRest,
  crossingDraws,
  crossingFrame,
  crossingPresentation,
  crossingProgress,
  crossingRequest,
  guardPointerCapture,
  holdMotion,
  lastPointerPlace,
  maxTier,
  measureSurfaceChrome,
  presentationRoute,
  readinessAtBirth,
  readinessProve,
  readinessReborn,
  readinessRegister,
  readinessSettled,
  readinessUnregister,
  releaseMotion,
  seedTier,
  surfaceAcquire,
  surfaceEpochCurrent,
  surfaceRelease,
  surfaceUnclaimed,
  type CrossingState,
  type DomTextureSource,
  type SurfaceChrome,
  type SurfaceIdentity,
  type SurfaceReadiness,
} from '@munari/core'
import {
  MicroHostContext,
  getOrCreateHost,
  type MicroPose,
  type MicroSurfaceFrameCtx,
  type RegisteredSurface,
  type ViewportState,
} from './hostState'
import { mat4FromPositionEulerScale, mat4Identity, mat4Invert, mat4Multiply, type Mat4 } from './math'
import {
  createMicroMaterial,
  createMicroSurfaceTexture,
  createPlaneGeometry,
  deformMicroGeometry,
  type MicroGeometry,
  type MicroMaterial,
  type MicroMaterialOptions,
  type MicroRenderer,
  type MicroSurfaceTexture,
} from './webgpu'

export { MicroCanvas, type MicroCanvasProps } from './MicroCanvas'
export {
  getMicroHostStats,
  simulateMicroDeviceLoss,
  type MicroHostStats,
  type MicroPose,
  type MicroSurfaceFrameCtx,
  type MicroViewport,
} from './hostState'

export interface MicroMaterialFactory {
  readonly sampleViewFormat?: 'rgba8unorm-srgb' | 'rgba8unorm'
  readonly create: (renderer: MicroRenderer) => MicroMaterial
}

export interface MicroSurfaceProps {
  readonly canvasId?: string
  readonly inScene?: boolean
  readonly exclusive?: boolean
  readonly size?: readonly [number, number]
  readonly resolution?: 'auto' | 'max' | number
  readonly live?: boolean
  readonly pointerEvents?: 'geometry' | 'content' | 'none'
  readonly placement?: 'match-dom' | 'manual'
  readonly segments?: readonly [number, number]
  readonly material?: MicroMaterialOptions
  readonly materialFactory?: MicroMaterialFactory
  readonly onFrame?: (ctx: MicroSurfaceFrameCtx) => void
  readonly onPresentationChange?: (presentation: 'page' | 'scene' | 'none') => void
  readonly children?: ReactNode
}

let surfaceSeq = 0
let tokenSeq = 1

function insertClean(node: HTMLElement, parent: HTMLElement) {
  if (node.parentElement === parent) return
  if ('moveBefore' in parent) {
    try {
      // SAFETY: Chrome 133+ exposes Element.prototype.moveBefore to preserve animation/focus state across reparenting.
      const movedParent = parent as HTMLElement & { moveBefore: (n: Node, ref: Node | null) => void }
      movedParent.moveBefore(node, null)
      return
    } catch {
      // Fall back to append when moveBefore cannot move across trees.
    }
  }
  parent.append(node)
}

function resolveInitialScale(resolution: 'auto' | 'max' | number, size: readonly [number, number]): number {
  const ladder = clampTiers(DEFAULT_TIERS, size[0], size[1])
  if (resolution === 'max') return maxTier(DEFAULT_TIERS, size[0], size[1])
  if (resolution === 'auto') return seedTier(ladder, window.devicePixelRatio || 1)
  return clampScale(resolution, size[0], size[1])
}

function updatePageVisibility(pageEl: HTMLElement | null, hidePage: boolean) {
  if (!pageEl) return
  pageEl.style.visibility = hidePage ? 'hidden' : ''
  pageEl.inert = hidePage
  if (hidePage) pageEl.setAttribute('aria-hidden', 'true')
  else pageEl.removeAttribute('aria-hidden')
}

function matchDomPose(rect: DOMRect, viewport: ViewportState, size: readonly [number, number]): MicroPose {
  return {
    x: rect.left + rect.width / 2 - viewport.width / 2,
    y: viewport.height / 2 - (rect.top + rect.height / 2),
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: rect.width / Math.max(1, size[0]),
    sy: rect.height / Math.max(1, size[1]),
    sz: 1,
  }
}

function clonePlaceholder(liveRoot: HTMLElement, pageEl: HTMLElement): HTMLElement | null {
  const copy = liveRoot.cloneNode(true)
  if (!(copy instanceof HTMLElement)) return null
  copy.inert = true
  copy.setAttribute('aria-hidden', 'true')
  pageEl.append(copy)
  return copy
}

function buildWorldAndMvp(p: MicroPose, viewProj: Mat4, worldMat: Mat4, invWorldMat: Mat4): Mat4 {
  mat4FromPositionEulerScale(
    p.x,
    p.y,
    p.z,
    p.rx ?? 0,
    p.ry ?? 0,
    p.rz ?? 0,
    p.sx ?? 1,
    p.sy ?? 1,
    p.sz ?? 1,
    worldMat,
  )
  mat4Invert(worldMat, invWorldMat)
  return mat4Multiply(viewProj, worldMat)
}

function dockSourceHost(source: DomTextureSource | null, dock: HTMLElement | null): void {
  if (source && dock && source.host.parentElement !== dock) {
    dock.append(source.host)
  }
}

export function MicroSurface({
  canvasId = '',
  inScene = true,
  exclusive = true,
  size,
  resolution = 'auto',
  live = false,
  pointerEvents = 'geometry',
  placement = 'match-dom',
  segments = [1, 1],
  material: materialOptions,
  materialFactory,
  onFrame,
  onPresentationChange,
  children,
}: MicroSurfaceProps) {
  const inheritedHost = use(MicroHostContext)
  const host = inheritedHost ?? getOrCreateHost(canvasId)
  const [surfaceId] = useState(() => `micro-surface-${surfaceSeq++}`)
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null)
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null)
  const [liveRoot, setLiveRoot] = useState<HTMLDivElement | null>(null)
  const [captureRoot] = useState(() => {
    const el = document.createElement('div')
    el.className = 'ui-root'
    el.style.display = 'block'
    guardPointerCapture(el)
    return el
  })

  const [measured, setMeasured] = useState<readonly [number, number]>([size?.[0] ?? 320, size?.[1] ?? 180])
  const effectiveSize: readonly [number, number] = size ?? measured
  const sizeRef = useRef(effectiveSize)
  sizeRef.current = effectiveSize

  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const onPresRef = useRef(onPresentationChange)
  onPresRef.current = onPresentationChange
  const pointerEventsRef = useRef(pointerEvents)
  pointerEventsRef.current = pointerEvents
  const placementRef = useRef(placement)
  placementRef.current = placement
  const pageElRef = useRef(pageEl)
  pageElRef.current = pageEl
  const dockElRef = useRef(dockEl)
  dockElRef.current = dockEl
  const liveRootRef = useRef(liveRoot)
  liveRootRef.current = liveRoot
  const resolutionRef = useRef(resolution)
  resolutionRef.current = resolution
  const materialOptionsRef = useRef(materialOptions)
  materialOptionsRef.current = materialOptions
  const materialFactoryRef = useRef(materialFactory)
  materialFactoryRef.current = materialFactory
  const inSceneRef = useRef(inScene)
  inSceneRef.current = inScene

  const sourceRef = useRef<DomTextureSource | null>(null)
  const texRef = useRef<MicroSurfaceTexture | null>(null)
  const geoRef = useRef<MicroGeometry | null>(null)
  const matRef = useRef<MicroMaterial | null>(null)
  const chromeRef = useRef<SurfaceChrome>(EMPTY_CHROME)
  const crossingRef = useRef<CrossingState>(crossingAtRest())
  const identityRef = useRef<SurfaceIdentity>(surfaceUnclaimed())
  const readinessRef = useRef<SurfaceReadiness>(readinessAtBirth())
  const askReadRef = useRef<number>(0)
  const lastPaintCountRef = useRef<number>(-1)
  const extraUploadsRef = useRef<number>(0)
  const workClaimRef = useRef<(() => void) | null>(null)
  const presentedRef = useRef<'page' | 'scene' | 'none'>('page')
  const worldMatRef = useRef<Mat4>(mat4Identity())
  const invWorldMatRef = useRef<Mat4>(mat4Identity())
  const poseRef = useRef<MicroPose>({ x: 0, y: 0, z: 0 })
  const placeholderRef = useRef<HTMLElement | null>(null)
  const heldMotionRef = useRef<Animation[]>([])
  const presenterKey = surfaceId

  const reconcileWorkClaim = useCallback(() => {
    const crossing = crossingRef.current
    const moving =
      crossing.phase === 'lifting' ||
      crossing.phase === 'landing' ||
      (crossing.phase === 'gl' && crossing.ramp < 1)
    const needsWork = moving || extraUploadsRef.current > 0
    if (needsWork && !workClaimRef.current) {
      workClaimRef.current = host.claimWork()
    } else if (!needsWork && workClaimRef.current) {
      workClaimRef.current()
      workClaimRef.current = null
    }
  }, [host])

  const syncDomHold = useCallback(() => {
    const pageNode = pageElRef.current
    const liveNode = liveRootRef.current
    const draws = crossingDraws(crossingRef.current.phase)
    const pres = crossingPresentation(crossingRef.current.phase)
    const nextPres: 'page' | 'scene' | 'none' = pres.gl ? 'scene' : pres.page ? 'page' : 'none'

    updatePageVisibility(pageNode, exclusive && !draws.page)

    if (liveNode && pageNode) {
      const useCapture = !exclusive || draws.gl
      const targetParent = useCapture ? captureRoot : pageNode
      if (liveNode.parentElement !== targetParent) {
        if (!useCapture) {
          placeholderRef.current?.remove()
          placeholderRef.current = null
          const place = lastPointerPlace()
          if (place) bridgeHover(pageNode, place.x, place.y)
          releaseMotion(heldMotionRef.current)
          heldMotionRef.current = []
        } else {
          if (exclusive && draws.page && !placeholderRef.current) {
            placeholderRef.current = clonePlaceholder(liveNode, pageNode)
          }
          heldMotionRef.current = holdMotion(liveNode)
        }
        insertClean(liveNode, targetParent)
        sourceRef.current?.repaint({ immediate: true })
      } else if (!draws.page && placeholderRef.current) {
        placeholderRef.current.remove()
        placeholderRef.current = null
      }
    }

    if (nextPres !== presentedRef.current) {
      presentedRef.current = nextPres
      onPresRef.current?.(nextPres)
    }
  }, [captureRoot, exclusive])
  const syncDomHoldRef = useRef(syncDomHold)
  syncDomHoldRef.current = syncDomHold

  useLayoutEffect(() => {
    if (size || !pageEl) return
    const measure = () => {
      const r = pageEl.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        setMeasured((cur) => (cur[0] === r.width && cur[1] === r.height ? cur : [r.width, r.height]))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(pageEl)
    return () => ro.disconnect()
  }, [pageEl, size])

  useLayoutEffect(() => {
    let source: DomTextureSource | null = null
    const setupGpu = () => {
      const renderer = host.renderer
      if (!renderer || texRef.current) return
      texRef.current = createMicroSurfaceTexture(renderer)
      geoRef.current = createPlaneGeometry(
        renderer.device,
        sizeRef.current[0],
        sizeRef.current[1],
        segments[0],
        segments[1],
      )
      matRef.current = materialFactoryRef.current
        ? materialFactoryRef.current.create(renderer)
        : createMicroMaterial(renderer, materialOptionsRef.current)
      lastPaintCountRef.current = -1
      const nextCrossing = crossingRequest(crossingRef.current, inSceneRef.current)
      if (nextCrossing !== crossingRef.current) {
        crossingRef.current = nextCrossing
        syncDomHoldRef.current()
        reconcileWorkClaim()
      }
      void matRef.current.ready.then(() => host.invalidate())
      host.invalidate()
    }

    source = createDomTextureSource(captureRoot, sizeRef.current[0], sizeRef.current[1], {
      scale: resolveInitialScale(resolution, sizeRef.current),
      live,
    })
    sourceRef.current = source
    dockSourceHost(source, dockElRef.current)
    lastPaintCountRef.current = -1
    const unsubPaint = source.subscribePaint(() => {
      const wake = host.claimWork()
      host.invalidate()
      queueMicrotask(wake)
    })

    setupGpu()
    const unsubReady = host.onReady(setupGpu)

    const token = tokenSeq++
    identityRef.current = surfaceAcquire(identityRef.current, token)
    const acquiredEpoch = identityRef.current.epoch
    readinessRef.current = readinessRegister(readinessRef.current, presenterKey)

    const syncUploadIfNeeded = (src: DomTextureSource, tex: MicroSurfaceTexture) => {
      const count = src.paintCount()
      const res = resolutionRef.current
      if (src.painted() && count !== lastPaintCountRef.current) {
        lastPaintCountRef.current = count
        extraUploadsRef.current = src.drawTrailsPaint ? 1 : 0
        const paint = src.currentPaint()
        if (paint) tex.syncUpload(src, paint.frame.generation, paint.read, res !== 'auto' || src.scale() <= 0.5)
        const nextChrome = measureSurfaceChrome(liveRootRef.current ?? src.element)
        if (!chromeEquals(chromeRef.current, nextChrome)) chromeRef.current = nextChrome
      } else if (extraUploadsRef.current > 0) {
        extraUploadsRef.current -= 1
        const paint = src.currentPaint()
        if (paint) tex.syncUpload(src, paint.frame.generation, paint.read, res !== 'auto' || src.scale() <= 0.5)
      }
    }

    const reg: RegisteredSurface = {
      id: surfaceId,
      pointerEvents: () => pointerEventsRef.current,
      hears: () => {
        const draws = crossingDraws(crossingRef.current.phase)
        return draws.gl && crossingPresentation(crossingRef.current.phase).gl
      },
      element: () => liveRootRef.current ?? captureRoot,
      size: () => sizeRef.current,
      radii: () => chromeRef.current.radii,
      geometry: () => geoRef.current,
      worldMat: () => worldMatRef.current,
      invWorldMat: () => invWorldMatRef.current,
      onRendererLost() {
        workClaimRef.current?.()
        workClaimRef.current = null
        matRef.current?.dispose()
        matRef.current = null
        geoRef.current?.dispose()
        geoRef.current = null
        texRef.current?.dispose()
        texRef.current = null
        lastPaintCountRef.current = -1
        readinessRef.current = readinessReborn(readinessRef.current)
        crossingRef.current = crossingAtRest()
        syncDomHoldRef.current()
      },
      tick(dtMs, elapsedMs, viewport) {
        const src = sourceRef.current
        const tex = texRef.current
        const geo = geoRef.current
        const mat = matRef.current
        if (!src || !tex || !geo || !mat || !host.renderer) return null

        syncUploadIfNeeded(src, tex)
        if (!crossingDraws(crossingRef.current.phase).gl) return null

        const pageNode = pageElRef.current
        const pageRect = pageNode ? pageNode.getBoundingClientRect() : null
        if (placementRef.current === 'match-dom' && pageRect && pageRect.width > 0 && pageRect.height > 0) {
          poseRef.current = matchDomPose(pageRect, viewport, sizeRef.current)
        }

        const progress = crossingRef.current.ramp
        const easedProgress = crossingProgress(progress)
        onFrameRef.current?.({
          dtMs,
          elapsedMs,
          progress,
          easedProgress,
          phase: crossingRef.current.phase,
          presentation: presentedRef.current,
          size: sizeRef.current,
          chrome: chromeRef.current,
          geometry: geo,
          material: mat,
          viewport,
          pageRect,
          setPose: (p) => { poseRef.current = p },
          deform: (place) => deformMicroGeometry(geo, sizeRef.current, place),
          setExtraAttribute: (slot, data) => geo.setExtraAttribute(slot, data),
          setCustomUniforms: (data) => mat.writeCustomUniforms(data),
        })

        const mvp = buildWorldAndMvp(poseRef.current, viewport.viewProj, worldMatRef.current, invWorldMatRef.current)

        const ready = readinessSettled(readinessRef.current)
        const colorWrite = ready && (crossingRef.current.phase !== 'lifting' || mat.isReady())
        const viewFormat =
          materialFactoryRef.current?.sampleViewFormat ??
          materialOptionsRef.current?.sampleViewFormat ??
          'rgba8unorm'

        return {
          geometry: geo,
          material: mat,
          view: tex.view(viewFormat),
          sampler: tex.sampler,
          modelWorld: worldMatRef.current,
          mvp,
          size: sizeRef.current,
          radii: chromeRef.current.radii,
          colorWrite,
          onPassComplete(receipt) {
            if (!tex.uploaded()) return
            const route = presentationRoute(
              {
                defaultFramebuffer: true,
                colorWrite: receipt.colorWritten,
                depthWrite: false,
                stencilWrite: false,
                drawable: receipt.triangles > 0,
              },
              true,
            )
            if (route === 'empty') return
            const epoch = surfaceEpochCurrent(identityRef.current, acquiredEpoch)
            if (!epoch) return
            readinessRef.current = readinessProve(readinessRef.current, presenterKey, readinessRef.current.lifetime)
            const contentCurrent =
              crossingRef.current.heldMs >= 200 || tex.uploadedRead() >= askReadRef.current
            crossingRef.current = crossingFrame(
              crossingRef.current,
              { presented: route === 'now' ? 1 : 0, required: 1, contentCurrent },
              dtMs,
            )
            syncDomHoldRef.current()
            reconcileWorkClaim()
          },
        }
      },
    }

    const unregHost = host.registerSurface(reg)
    return () => {
      unregHost()
      unsubReady()
      unsubPaint()
      workClaimRef.current?.()
      workClaimRef.current = null
      readinessRef.current = readinessUnregister(readinessRef.current, presenterKey)
      identityRef.current = surfaceRelease(identityRef.current, token)
      matRef.current?.dispose()
      matRef.current = null
      geoRef.current?.dispose()
      geoRef.current = null
      texRef.current?.dispose()
      texRef.current = null
      source?.dispose()
      sourceRef.current = null
    }
    // Intentional mount-scoped setup for capture/GPU lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, captureRoot, surfaceId])

  useLayoutEffect(() => {
    const [w, h] = effectiveSize
    captureRoot.style.width = `${w}px`
    captureRoot.style.height = `${h}px`
    sourceRef.current?.setSize(w, h)
  }, [captureRoot, effectiveSize])

  useLayoutEffect(() => {
    const src = sourceRef.current
    if (src) askReadRef.current = src.nextRead()
    const next = crossingRequest(crossingRef.current, inScene)
    if (next !== crossingRef.current) {
      crossingRef.current = next
      syncDomHold()
      reconcileWorkClaim()
      host.invalidate()
    }
  }, [inScene, host, syncDomHold, reconcileWorkClaim])

  useLayoutEffect(() => {
    dockSourceHost(sourceRef.current, dockEl)
  }, [dockEl])

  if (!exclusive) {
    return (
      <>
        <div ref={setDockEl} style={{ display: 'contents', pointerEvents: 'none' }} />
        {createPortal(
          <div ref={setLiveRoot} style={{ width: effectiveSize[0], height: effectiveSize[1] }}>
            {children}
          </div>,
          captureRoot,
        )}
      </>
    )
  }

  return (
    <>
      <div ref={setDockEl} style={{ display: 'contents', pointerEvents: 'none' }} />
      <div
        ref={setPageEl}
        data-micro-page-slot=""
        style={{
          width: size ? size[0] : undefined,
          height: size ? size[1] : undefined,
          position: 'relative',
        }}
      >
        <div ref={setLiveRoot} style={{ width: size ? size[0] : undefined, height: size ? size[1] : undefined }}>
          {children}
        </div>
      </div>
    </>
  )
}
