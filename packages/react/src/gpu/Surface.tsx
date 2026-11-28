// WebGPU Surface primitive — retained HTML content in a single React reconciler
// paired with an exclusive or non-exclusive dual-view WebGPU presenter.
//
// The law: HTML stays alive in React's tree (native inputs, focus, selection,
// ARIA). A Surface transitions cleanly through `@munari/core`'s four-phase
// crossing: never hiding the page until the GPU material has compiled both its
// color and write-free warmup pipelines AND completed a first upload+draw, then
// mirroring `--munari-body` cleanly across page and capture (`decisions.md #79`).
//
// Ownership: `SurfaceCanvas` owns the `GpuHost` & device lifecycle; `surfaceDom`
// owns pure DOM/pose helpers; `Surface` owns GPU resource slots & crossing sync.

import { use, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EMPTY_CHROME,
  captureAvailable,
  createDomTextureSource,
  crossingAtRest,
  crossingDraws,
  crossingFrame,
  crossingPresentation,
  crossingRequest,
  readinessAtBirth,
  readinessReborn,
  readinessRegister,
  readinessSettled,
  readinessUnregister,
  surfaceAcquire,
  surfaceRelease,
  surfaceUnclaimed,
  type CrossingState,
  type DomTextureSource,
  type SurfaceIdentity,
  type SurfaceReadiness,
} from '@munari/core'
import { createManifestDriver } from './manifest'
import { mat4Identity, type Mat4 } from './math'
import {
  createGpuSurfaceTexture,
  createPlaneGeometry,
  type GpuGeometry,
  type GpuMaterial,
  type GpuSurfaceTexture,
} from './webgpu'
import { GpuHostContext, getOrCreateGpuHost, type RegisteredSurface } from './host'
import {
  advanceSurfacePass,
  buildSurfaceSlotStyle,
  computeBleedUvRect,
  disposeSurfaceGpuSlots,
  dockSourceHost,
  isManifestMaterial,
  makeCaptureRoot,
  observeElementSize,
  reparentLiveDom,
  resolveBleed,
  resolveInitialScale,
  resolveSurfaceViewFormat,
  syncUploadIfNeeded,
  updatePageVisibility,
  useFinishModule,
  useShadowModule,
  writeCaptureBodyColor,
  type SurfacePose,
  type SurfacePresentation,
  type SurfaceProps,
} from './surfaceDom'
import type { GpuSurfaceShadowHandle } from './surfaceShadow'
import {
  buildSurfaceMaterial,
  runSurfaceTick,
  syncSurfaceMaterialSlot,
  syncSurfaceShadowHandle,
  type ActiveMaterialSlot,
} from './surfaceTick'

export type {
  GpuViewport,
  SurfaceFrameContext,
  SurfacePose,
  SurfacePresentation,
  SurfaceProps,
} from './surfaceDom'

let surfaceSeq = 0
let tokenSeq = 1

function resolvePageSlotSize(
  size: readonly [number, number] | undefined,
  slotPinned: boolean,
  hasMeasured: boolean,
  measured: readonly [number, number],
): readonly [number, number] | undefined {
  return size ?? (slotPinned && hasMeasured ? measured : undefined)
}

function liveRootStyle(size: readonly [number, number] | undefined) {
  return { width: size ? size[0] : undefined, height: size ? size[1] : undefined }
}

export function Surface<TUniforms = Record<string, never>>({
  canvasId = '',
  inScene = true,
  exclusive = true,
  size,
  resolution = 'auto',
  live = false,
  pointerEvents = 'geometry',
  placement = 'match-dom',
  segments = [1, 1],
  pixelSnap = false,
  bleed,
  shadow,
  finish,
  material: materialProp,
  uniforms,
  materialFactory,
  onFrame,
  onPresentationChange,
  children,
}: SurfaceProps<TUniforms>) {
  const inheritedHost = use(GpuHostContext)
  const host = inheritedHost ?? getOrCreateGpuHost(canvasId)
  const [surfaceId] = useState(() => `gpu-surface-${surfaceSeq++}`)
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null)
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null)
  const [liveRoot, setLiveRoot] = useState<HTMLDivElement | null>(null)
  const [captureRoot] = useState(makeCaptureRoot)

  const finishMod = useFinishModule(Boolean(finish))
  const shadowMod = useShadowModule(Boolean(shadow))
  const [bleedX, bleedY] = resolveBleed(bleed)
  const [size0, size1] = size ?? [320, 180]
  const [measured, setMeasured] = useState<readonly [number, number]>(() => [size0, size1])
  const [hasMeasured, setHasMeasured] = useState(false)
  const [slotPinned, setSlotPinned] = useState(false)
  const effectiveSize: readonly [number, number] = size ?? measured

  const manifestDriver = useMemo(() => (materialProp ? createManifestDriver(materialProp) : null), [materialProp])
  const effectiveFactory = materialFactory ?? manifestDriver?.factory
  const viewFmt = resolveSurfaceViewFormat(finish, effectiveFactory)

  const sizeRef = useRef(effectiveSize)
  sizeRef.current = effectiveSize
  const inSceneRef = useRef(inScene)
  inSceneRef.current = inScene
  const finishRef = useRef(finish)
  finishRef.current = finish
  const finishModRef = useRef(finishMod)
  finishModRef.current = finishMod
  const uniformsRef = useRef(uniforms)
  uniformsRef.current = uniforms
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const onPresRef = useRef(onPresentationChange)
  onPresRef.current = onPresentationChange
  const pointerEventsRef = useRef(pointerEvents)
  pointerEventsRef.current = pointerEvents
  const placementRef = useRef(placement)
  placementRef.current = placement
  const pixelSnapRef = useRef(pixelSnap)
  pixelSnapRef.current = pixelSnap
  const bleedRef = useRef<readonly [number, number]>([bleedX, bleedY])
  bleedRef.current = [bleedX, bleedY]
  const shadowPropRef = useRef(shadow)
  shadowPropRef.current = shadow
  const shadowModRef = useRef(shadowMod)
  shadowModRef.current = shadowMod
  const shadowRef = useRef<GpuSurfaceShadowHandle | null>(null)
  const viewFmtRef = useRef(viewFmt)
  viewFmtRef.current = viewFmt
  const resolutionRef = useRef(resolution)
  resolutionRef.current = resolution
  const pageElRef = useRef(pageEl)
  pageElRef.current = pageEl
  const dockElRef = useRef(dockEl)
  dockElRef.current = dockEl
  const liveRootRef = useRef(liveRoot)
  liveRootRef.current = liveRoot
  const factoryRef = useRef(effectiveFactory)
  factoryRef.current = effectiveFactory
  const segmentsRef = useRef(segments)
  segmentsRef.current = segments
  const prevLiveRef = useRef(live)
  const geoMetaRef = useRef<{ w: number; h: number; sx: number; sy: number; bx: number; by: number } | null>(null)
  const activeMatRef = useRef<ActiveMaterialSlot | null>(null)

  const sourceRef = useRef<DomTextureSource | null>(null)
  const texRef = useRef<GpuSurfaceTexture | null>(null)
  const geoRef = useRef<GpuGeometry | null>(null)
  const matRef = useRef<GpuMaterial | null>(null)
  const uploadStateRef = useRef({ lastPaint: -1, extraUploads: 0, chrome: EMPTY_CHROME })
  const crossingRef = useRef<CrossingState>(crossingAtRest())
  const identityRef = useRef<SurfaceIdentity>(surfaceUnclaimed())
  const readinessRef = useRef<SurfaceReadiness>(readinessAtBirth())
  const askReadRef = useRef(0)
  const workClaimRef = useRef<(() => void) | null>(null)
  const frameClaimRef = useRef<(() => void) | null>(null)
  const presentedRef = useRef<SurfacePresentation>('page')
  const worldMatRef = useRef<Mat4>(mat4Identity())
  const invWorldMatRef = useRef<Mat4>(mat4Identity())
  const poseRef = useRef<SurfacePose>({ x: 0, y: 0, z: 0 })
  const holdStateRef = useRef<{ placeholder: HTMLElement | null; heldMotion: Animation[] }>({
    placeholder: null,
    heldMotion: [],
  })
  const bodyColor = finish?.color ?? null
  const presenterKey = surfaceId

  const setFrameClaim = useCallback(
    (active: boolean) => {
      if (active && !frameClaimRef.current) {
        frameClaimRef.current = host.claimWork()
      } else if (!active && frameClaimRef.current) {
        frameClaimRef.current()
        frameClaimRef.current = null
      }
    },
    [host],
  )

  const reconcileWorkClaim = useCallback(() => {
    const crossing = crossingRef.current
    const moving =
      crossing.phase === 'lifting' ||
      crossing.phase === 'landing' ||
      (crossing.phase === 'gl' && crossing.ramp < 1)
    const needsWork = moving || uploadStateRef.current.extraUploads > 0
    if (needsWork && !workClaimRef.current) {
      workClaimRef.current = host.claimWork()
    } else if (!needsWork && workClaimRef.current) {
      workClaimRef.current()
      workClaimRef.current = null
    }
  }, [host])

  const syncDomHold = useCallback(() => {
    const pageNode = pageElRef.current
    const draws = crossingDraws(crossingRef.current.phase)
    const pres = crossingPresentation(crossingRef.current.phase)
    const nextPres: SurfacePresentation = pres.gl ? 'scene' : pres.page ? 'page' : 'none'

    setSlotPinned(Boolean(exclusive && !draws.page))
    updatePageVisibility(pageNode, exclusive && !draws.page)
    writeCaptureBodyColor(captureRoot, finishRef.current?.color ?? null, exclusive && draws.page, sourceRef.current)
    reparentLiveDom(liveRootRef.current, pageNode, captureRoot, exclusive, draws, holdStateRef.current, sourceRef.current)

    if (nextPres !== presentedRef.current) {
      presentedRef.current = nextPres
      onPresRef.current?.(nextPres)
    }
  }, [captureRoot, exclusive])
  const syncDomHoldRef = useRef(syncDomHold)
  syncDomHoldRef.current = syncDomHold

  useLayoutEffect(() => {
    const target = liveRoot ?? pageEl
    if (size || !target) return
    return observeElementSize(target, (w, h) => {
      setHasMeasured(true)
      setMeasured((cur) => (cur[0] === w && cur[1] === h ? cur : [w, h]))
    })
  }, [liveRoot, pageEl, size])

  useLayoutEffect(() => {
    const renderer = host.renderer
    if (!renderer) return
    const next = syncSurfaceMaterialSlot({
      renderer,
      curMat: matRef.current,
      active: activeMatRef.current,
      finish,
      finishMod,
      effectiveFactory,
      uniforms,
      invalidate: () => host.invalidate(),
    })
    matRef.current = next.mat
    activeMatRef.current = next.active
  }, [host, finish, finishMod, effectiveFactory, uniforms])

  useLayoutEffect(() => {
    const renderer = host.renderer
    if (!renderer) return
    shadowRef.current = syncSurfaceShadowHandle(
      shadowRef.current,
      renderer,
      shadow,
      shadowMod,
      () => host.invalidate(),
    )
  }, [host, shadow, shadowMod])

  useLayoutEffect(() => {
    if (!captureAvailable()) {
      sourceRef.current = null
      return
    }
    let source: DomTextureSource | null = null
    const setupGpu = () => {
      const renderer = host.renderer
      if (!renderer || texRef.current) return
      const [w, h] = sizeRef.current
      const [sx, sy] = segmentsRef.current
      const [bx, by] = bleedRef.current
      texRef.current = createGpuSurfaceTexture(renderer)
      geoRef.current = createPlaneGeometry(renderer.device, w, h, sx, sy, bx, by)
      geoMetaRef.current = { w, h, sx, sy, bx, by }
      if (!shadowRef.current && shadowPropRef.current && shadowModRef.current) {
        shadowRef.current = shadowModRef.current.createGpuSurfaceShadow(renderer, shadowPropRef.current)
        void shadowRef.current.ready.then(() => host.invalidate(), () => {})
      }
      if (!matRef.current) {
        matRef.current = buildSurfaceMaterial(
          renderer,
          finishRef.current,
          finishModRef.current,
          factoryRef.current,
          () => host.invalidate(),
        )
        activeMatRef.current = matRef.current
          ? { isFinish: Boolean(finishRef.current), factory: factoryRef.current }
          : null
        if (matRef.current) {
          if (uniformsRef.current !== undefined && isManifestMaterial<TUniforms>(matRef.current)) {
            matRef.current.setUniforms(uniformsRef.current)
          }
          void matRef.current.ready.then(() => host.invalidate(), () => {})
        }
      }
      uploadStateRef.current.lastPaint = -1
      const nextCrossing = crossingRequest(crossingRef.current, inSceneRef.current)
      if (nextCrossing !== crossingRef.current) {
        crossingRef.current = nextCrossing
        syncDomHoldRef.current()
        reconcileWorkClaim()
      }
      host.invalidate()
    }

    source = createDomTextureSource(captureRoot, sizeRef.current[0], sizeRef.current[1], {
      scale: resolveInitialScale(resolution, sizeRef.current),
      live,
    })
    sourceRef.current = source
    dockSourceHost(source, dockElRef.current)
    uploadStateRef.current.lastPaint = -1
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

    const clearGpu = () => {
      const slots = {
        mat: matRef.current,
        activeMat: activeMatRef.current,
        geo: geoRef.current,
        geoMeta: geoMetaRef.current,
        tex: texRef.current,
        lastPaint: uploadStateRef.current.lastPaint,
      }
      disposeSurfaceGpuSlots(slots)
      shadowRef.current?.dispose()
      shadowRef.current = null
      matRef.current = null
      activeMatRef.current = null
      geoRef.current = null
      geoMetaRef.current = null
      texRef.current = null
      uploadStateRef.current.lastPaint = -1
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
      radii: () => uploadStateRef.current.chrome.radii,
      geometry: () => geoRef.current,
      worldMat: () => worldMatRef.current,
      invWorldMat: () => invWorldMatRef.current,
      onRendererLost() {
        workClaimRef.current?.()
        workClaimRef.current = null
        setFrameClaim(false)
        clearGpu()
        readinessRef.current = readinessReborn(readinessRef.current)
        crossingRef.current = crossingAtRest()
        syncDomHoldRef.current()
      },
      tick(dtMs, elapsedMs, viewport) {
        const src = sourceRef.current
        const tex = texRef.current
        const geo = geoRef.current
        const mat = matRef.current
        if (!src || !tex || !geo || !mat || !host.renderer) {
          setFrameClaim(false)
          return null
        }

        syncUploadIfNeeded(src, tex, resolutionRef.current, liveRootRef.current, uploadStateRef.current)
        if (!crossingDraws(crossingRef.current.phase).gl) {
          setFrameClaim(false)
          return null
        }

        return runSurfaceTick({
          dtMs,
          elapsedMs,
          viewport,
          src,
          tex,
          geo,
          mat,
          placement: placementRef.current,
          pageEl: pageElRef.current,
          size: sizeRef.current,
          pixelSnap: pixelSnapRef.current,
          bleedUvRect: computeBleedUvRect(sizeRef.current, bleedRef.current),
          shadow: shadowRef.current,
          lighting: host.lighting,
          viewFmt: viewFmtRef.current,
          chrome: uploadStateRef.current.chrome,
          crossing: crossingRef.current,
          presentation: presentedRef.current,
          ready: readinessSettled(readinessRef.current),
          pose: poseRef.current,
          setPose: (p) => { poseRef.current = p },
          worldMat: worldMatRef.current,
          invWorldMat: invWorldMatRef.current,
          onFrame: onFrameRef.current,
          setFrameClaim,
          onPassComplete(receipt) {
            const nextState = advanceSurfacePass({
              receipt,
              tex,
              identity: identityRef.current,
              acquiredEpoch,
              presenterKey,
              askRead: askReadRef.current,
              dtMs,
              crossing: crossingRef.current,
              readiness: readinessRef.current,
              crossingFrameFn: crossingFrame,
            })
            if (!nextState) return
            readinessRef.current = nextState.readiness
            crossingRef.current = nextState.crossing
            syncDomHoldRef.current()
            reconcileWorkClaim()
          },
        })
      },
    }

    const unregHost = host.registerSurface(reg)
    return () => {
      unregHost()
      unsubReady()
      unsubPaint()
      workClaimRef.current?.()
      workClaimRef.current = null
      setFrameClaim(false)
      readinessRef.current = readinessUnregister(readinessRef.current, presenterKey)
      identityRef.current = surfaceRelease(identityRef.current, token)
      clearGpu()
      source?.dispose()
      sourceRef.current = null
    }
    // Intentional mount-scoped setup for capture/GPU resource lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, captureRoot, surfaceId])

  const [sizeW, sizeH] = effectiveSize
  const [segX, segY] = segments

  useLayoutEffect(() => {
    const renderer = host.renderer
    const curGeo = geoRef.current
    if (!renderer || !curGeo) return
    const prev = geoMetaRef.current
    if (
      prev &&
      prev.w === sizeW &&
      prev.h === sizeH &&
      prev.sx === segX &&
      prev.sy === segY &&
      prev.bx === bleedX &&
      prev.by === bleedY
    ) {
      return
    }
    curGeo.dispose()
    geoRef.current = createPlaneGeometry(renderer.device, sizeW, sizeH, segX, segY, bleedX, bleedY)
    geoMetaRef.current = { w: sizeW, h: sizeH, sx: segX, sy: segY, bx: bleedX, by: bleedY }
    host.invalidate()
  }, [host, sizeW, sizeH, segX, segY, bleedX, bleedY])

  useLayoutEffect(() => {
    const src = sourceRef.current
    if (!src) return
    const nextScale = resolveInitialScale(resolution, [sizeW, sizeH])
    if (src.scale() !== nextScale) {
      src.setScale(nextScale)
      host.invalidate()
    }
  }, [host, resolution, sizeW, sizeH])

  useLayoutEffect(() => {
    const src = sourceRef.current
    if (!src || prevLiveRef.current === live) return
    prevLiveRef.current = live
    src.setLive(live)
    host.invalidate()
  }, [host, live])

  useLayoutEffect(() => {
    const [w, h] = effectiveSize
    captureRoot.style.width = `${w}px`
    captureRoot.style.height = `${h}px`
    sourceRef.current?.setSize(w, h)
  }, [captureRoot, effectiveSize])

  useLayoutEffect(() => {
    const src = sourceRef.current
    if (!src) return
    askReadRef.current = src.nextRead()
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

  const slotSize = resolvePageSlotSize(size, slotPinned, hasMeasured, measured)
  const pageSlotStyle = useMemo(() => buildSurfaceSlotStyle(slotSize, bodyColor), [bodyColor, slotSize])
  const rootBoxStyle = useMemo(() => liveRootStyle(size), [size])

  if (!exclusive) {
    return (
      <>
        <div ref={setDockEl} style={{ display: 'contents', pointerEvents: 'none' }} />
        {createPortal(
          <div ref={setLiveRoot} style={rootBoxStyle}>
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
      <div ref={setPageEl} data-gpu-page-slot="" style={pageSlotStyle}>
        <div ref={setLiveRoot} style={rootBoxStyle}>
          {children}
        </div>
      </div>
    </>
  )
}
