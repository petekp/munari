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
  createDomTextureSource,
  crossingAtRest,
  crossingDraws,
  crossingFrame,
  crossingPresentation,
  crossingProgress,
  crossingRequest,
  presentationRoute,
  readinessAtBirth,
  readinessProve,
  readinessReborn,
  readinessRegister,
  readinessSettled,
  readinessUnregister,
  surfaceAcquire,
  surfaceEpochCurrent,
  surfaceRelease,
  surfaceUnclaimed,
  type CrossingState,
  type DomTextureSource,
  type SurfaceIdentity,
  type SurfaceReadiness,
} from '@munari/core'
import { createManifestDriver, createManifestMaterial, unlitSurfaceManifest } from './manifest'
import { mat4Identity, type Mat4 } from './math'
import {
  createGpuSurfaceTexture,
  createPlaneGeometry,
  deformGpuGeometry,
  type GpuGeometry,
  type GpuMaterial,
  type GpuRenderer,
  type GpuSurfaceTexture,
} from './webgpu'
import { GpuHostContext, getOrCreateGpuHost, type RegisteredSurface } from './host'
import {
  applyPixelSnap,
  buildSurfaceSlotStyle,
  buildWorldAndMvp,
  dockSourceHost,
  isFinishMaterial,
  isManifestMaterial,
  makeCaptureRoot,
  matchDomPose,
  reparentLiveDom,
  resolveInitialScale,
  resolveSurfaceViewFormat,
  snapSurfacePose,
  syncUploadIfNeeded,
  updatePageVisibility,
  useFinishModule,
  writeCaptureBodyColor,
  type SurfacePose,
  type SurfacePresentation,
  type SurfaceProps,
} from './surfaceDom'

export type {
  GpuViewport,
  SurfaceFrameContext,
  SurfacePose,
  SurfacePresentation,
  SurfaceProps,
} from './surfaceDom'

let surfaceSeq = 0
let tokenSeq = 1

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
  const [measured, setMeasured] = useState<readonly [number, number]>(() => [
    size ? size[0] : 320,
    size ? size[1] : 180,
  ])
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

  const buildMaterialFor = useCallback((renderer: GpuRenderer): GpuMaterial | null => {
    if (finishRef.current) {
      return finishModRef.current ? finishModRef.current.createGpuFinishMaterial(renderer, finishRef.current) : null
    }
    if (factoryRef.current) return factoryRef.current.create(renderer)
    return createManifestMaterial(renderer, unlitSurfaceManifest)
  }, [])

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
    const renderer = host.renderer
    if (!renderer) return
    const curMat = matRef.current
    if (finish && isFinishMaterial(curMat)) {
      curMat.updateFinish(finish, host.lighting, host.viewport.width, host.viewport.height, host.viewport.cameraZ)
      host.invalidate()
      return
    }
    if (!finish && curMat && !isFinishMaterial(curMat)) {
      if (uniforms !== undefined && isManifestMaterial<TUniforms>(curMat)) {
        curMat.setUniforms(uniforms)
        host.invalidate()
      }
      return
    }
    matRef.current?.dispose()
    const nextMat = buildMaterialFor(renderer)
    matRef.current = nextMat
    if (nextMat) {
      if (uniforms !== undefined && isManifestMaterial<TUniforms>(nextMat)) nextMat.setUniforms(uniforms)
      void nextMat.ready.then(() => host.invalidate())
    }
    host.invalidate()
  }, [host, finish, finishMod, materialProp, materialFactory, uniforms, buildMaterialFor])

  useLayoutEffect(() => {
    let source: DomTextureSource | null = null
    const setupGpu = () => {
      const renderer = host.renderer
      if (!renderer || texRef.current) return
      texRef.current = createGpuSurfaceTexture(renderer)
      geoRef.current = createPlaneGeometry(
        renderer.device,
        sizeRef.current[0],
        sizeRef.current[1],
        segments[0],
        segments[1],
      )
      matRef.current = buildMaterialFor(renderer)
      uploadStateRef.current.lastPaint = -1
      const nextCrossing = crossingRequest(crossingRef.current, inSceneRef.current)
      if (nextCrossing !== crossingRef.current) {
        crossingRef.current = nextCrossing
        syncDomHoldRef.current()
        reconcileWorkClaim()
      }
      if (matRef.current) {
        if (uniformsRef.current !== undefined && isManifestMaterial<TUniforms>(matRef.current)) {
          matRef.current.setUniforms(uniformsRef.current)
        }
        void matRef.current.ready.then(() => host.invalidate())
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
        matRef.current?.dispose()
        matRef.current = null
        geoRef.current?.dispose()
        geoRef.current = null
        texRef.current?.dispose()
        texRef.current = null
        uploadStateRef.current.lastPaint = -1
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

        syncUploadIfNeeded(src, tex, resolutionRef.current, liveRootRef.current, uploadStateRef.current)
        if (!crossingDraws(crossingRef.current.phase).gl) return null

        if (finishRef.current && isFinishMaterial(mat)) {
          mat.updateFinish(finishRef.current, host.lighting, viewport.width, viewport.height, viewport.cameraZ)
        }

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
          chrome: uploadStateRef.current.chrome,
          geometry: geo,
          material: mat,
          viewport,
          pageRect,
          setPose: (p) => { poseRef.current = p },
          snapPose: (x, y, mag) => snapSurfacePose(x, y, sizeRef.current, viewport, src, mag),
          deform: (place) => deformGpuGeometry(geo, sizeRef.current, place),
          setExtraAttribute: (slot, data) => geo.setExtraAttribute(slot, data),
          setCustomUniforms: (data) => mat.writeCustomUniforms(data),
        })

        const poseToDraw = applyPixelSnap(poseRef.current, pixelSnapRef.current, sizeRef.current, viewport, src)
        const mvp = buildWorldAndMvp(poseToDraw, viewport.viewProj, worldMatRef.current, invWorldMatRef.current)
        const ready = readinessSettled(readinessRef.current)
        const colorWrite = ready && (crossingRef.current.phase !== 'lifting' || mat.isReady())

        return {
          geometry: geo,
          material: mat,
          view: tex.view(viewFmtRef.current),
          sampler: tex.sampler,
          modelWorld: worldMatRef.current,
          mvp,
          size: sizeRef.current,
          radii: uploadStateRef.current.chrome.radii,
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
            if (!surfaceEpochCurrent(identityRef.current, acquiredEpoch)) return
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
    // Intentional mount-scoped setup for capture/GPU resource lifetime.
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

  const pageSlotStyle = useMemo(() => buildSurfaceSlotStyle(size, bodyColor), [bodyColor, size])

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
      <div ref={setPageEl} data-gpu-page-slot="" style={pageSlotStyle}>
        <div ref={setLiveRoot} style={{ width: size ? size[0] : undefined, height: size ? size[1] : undefined }}>
          {children}
        </div>
      </div>
    </>
  )
}
