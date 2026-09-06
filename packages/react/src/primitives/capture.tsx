// Capture sources — one owner publishes frames borrowed by any number of renderers.
// Source disposal clears the frame before any consumer can reuse its texture.
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'
import { detectHtmlInCanvas } from '@munari/core'
import type { Texture } from 'three'
import { createSurfaceSourceRuntime, type SurfaceSize, type SurfaceResolution, type SurfaceSourceRuntime } from './surface/surfaceSourceRuntime'
import { validateSurfaceSize } from './surface/surfaceSize'
import { subscribeSurfaceDevicePixelRatio, readSurfaceDevicePixelRatio } from './surface/surfaceDevicePixelRatio'
import { useLatest } from './useLatest'

export interface CaptureFrame {
  readonly sourceId:number; readonly generation:number; readonly revision:number
  readonly texture:Texture; readonly width:number; readonly height:number
  readonly anchors:Readonly<Record<string,Readonly<{x:number;y:number;width:number;height:number}>>>
}
export type CaptureStatus = { readonly status:'waiting'|'ready'|'unsupported'|'error'; readonly error?:string; readonly reason?:string }
interface CaptureModel {
  frame:CaptureFrame|null; status:CaptureStatus; frameListeners:Set<()=>void>; statusListeners:Set<()=>void>; owner:object|null; consumers:number
}
const captures = new WeakMap<CaptureHandle,CaptureModel>()
export interface CaptureHandle { readonly kind:'capture' }
export function createCapture():CaptureHandle {
  const handle:CaptureHandle = { kind:'capture' }
  captures.set(handle,{frame:null,status:{status:'waiting'},frameListeners:new Set(),statusListeners:new Set(),owner:null,consumers:0})
  return handle
}
export function useCaptureHandle() { return useMemo(createCapture,[]) }
function modelOf(handle:CaptureHandle) { const value=captures.get(handle); if(!value)throw new Error('Unknown capture handle');return value }
function captureStatus(model:CaptureModel,next:CaptureStatus) {
  if(next.status===model.status.status && next.error===model.status.error && next.reason===model.status.reason)return
  model.status=next;for(const listener of model.statusListeners)listener()
}
export function useCaptureStatus(handle:CaptureHandle) {
  const model=modelOf(handle)
  return useSyncExternalStore(useMemo(()=>(listener:()=>void)=>{model.statusListeners.add(listener);return()=>model.statusListeners.delete(listener)},[model]),()=>model.status,()=>model.status)
}
export function useCaptureFrame(handle:CaptureHandle) {
  const model=modelOf(handle)
  const invalidate=useThree(state=>state.invalidate)
  const canvas=useThree(state=>state.gl.domElement)
  useLayoutEffect(()=>{canvas.dataset.apiCaptureConsumer=''},[canvas])
  useCaptureStatus(handle)
  useLayoutEffect(()=>{model.consumers++;model.frameListeners.add(invalidate);invalidate();return()=>{model.consumers--;model.frameListeners.delete(invalidate)}},[model,invalidate])
  return useMemo(()=>({get:()=>model.frame}),[model])
}

export interface CaptureConnection {
  setSize(size: SurfaceSize): void
  setResolution(resolution: SurfaceResolution): void
  repaint(): void
  dispose(): void
}

export function setCaptureUnavailable(handle: CaptureHandle, status: 'waiting' | 'unsupported' | 'error', error?: string) {
  const model = modelOf(handle)
  model.frame = null
  captureStatus(model, status === 'error' ? { status, error } : { status, reason: error })
  for (const listener of model.frameListeners) listener()
}

// Both attached-element capture and authored React content publish through this owner.
export function connectCapture(handle: CaptureHandle, element: HTMLElement, size: SurfaceSize, options: {
  resolution?: SurfaceResolution
  onError?: (error: Error) => void
} = {}): CaptureConnection {
  validateSurfaceSize(size)
  const model = modelOf(handle)
  if (model.owner) throw new Error('A capture has one source owner')
  const owner = {}
  model.owner = owner
  let source: SurfaceSourceRuntime | null = null
  let frame = 0
  let alive = true
  let revision = 0
  let lastKey = ''
  let measuredGeneration = -1
  let measuredAnchors: CaptureFrame['anchors'] = {}
  let stopPaint = () => {}
  let stopDensity = () => {}
  const previousInert = element.inert
  const previousHidden = element.getAttribute('aria-hidden')
  const previousVisibility = element.style.visibility
  const notify = () => { for (const listener of model.frameListeners) listener() }
  const report = (error: Error) => {
    setCaptureUnavailable(handle, 'error', error.message)
    options.onError?.(error)
  }
  const publish = () => {
    const receipt = source?.currentPaint()
    const texture = source?.texture()
    if (!receipt || !texture || !source?.uploaded()) return
    if (measuredGeneration !== receipt.frame.generation) return
    const key = `${receipt.frame.sourceId}:${receipt.frame.generation}:${texture.version}`
    if (key === lastKey) return
    lastKey = key
    model.frame = Object.freeze({
      sourceId: receipt.frame.sourceId, generation: receipt.frame.generation,
      revision: ++revision, texture, width: receipt.paintedSize[0],
      height: receipt.paintedSize[1], anchors: measuredAnchors,
    })
    captureStatus(model, { status: 'ready' })
    notify()
  }
  const tick = () => {
    frame = 0
    if (!alive || !source) return
    const working = source.frame()
    publish()
    if (working) frame = requestAnimationFrame(tick)
  }
  const wake = () => { if (alive && source && !frame) frame = requestAnimationFrame(tick) }
  const connection: CaptureConnection = {
    setSize(next) { validateSurfaceSize(next); source?.setSize(next); wake() },
    setResolution(next) { source?.setResolution(next); wake() },
    repaint() { source?.source.repaint(); wake() },
    dispose() {
      if (!alive) return
      alive = false
      cancelAnimationFrame(frame)
      stopPaint()
      stopDensity()
      if (source) {
        source.dispose()
        element.inert = previousInert
        element.style.visibility = previousVisibility
        if (previousHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', previousHidden)
      }
      if (model.owner === owner) {
        model.owner = null
        setCaptureUnavailable(handle, 'waiting')
      }
    },
  }
  setCaptureUnavailable(handle, 'waiting')
  if (!detectHtmlInCanvas().drawElementImage) {
    setCaptureUnavailable(handle, 'unsupported')
    return connection
  }
  try {
    source = createSurfaceSourceRuntime({
      content: element, size, resolution: options.resolution ?? 'auto',
      mirrorU: false, paint: 'auto', pixelRatio: window.devicePixelRatio, onError: report,
    })
  } catch (cause) {
    report(cause instanceof Error ? cause : new Error(String(cause)))
    return connection
  }
  source.source.canvas.dataset.apiCapture = ''
  source.source.canvas.style.visibility = 'hidden'
  element.style.visibility = 'visible'
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
  stopPaint = source.subscribePaint(receipt => {
    const base = element.getBoundingClientRect()
    const anchors: Record<string, Readonly<{x:number;y:number;width:number;height:number}>> = {}
    for (const anchor of element.querySelectorAll<HTMLElement>('[data-munari-anchor]')) {
      const rect = anchor.getBoundingClientRect()
      const name = anchor.getAttribute('data-munari-anchor')!
      anchors[name] = Object.freeze({x:rect.left-base.left,y:rect.top-base.top,width:rect.width,height:rect.height})
    }
    measuredGeneration = receipt.frame.generation
    measuredAnchors = Object.freeze(anchors)
    wake()
  })
  stopDensity=subscribeSurfaceDevicePixelRatio(()=>{source?.setPixelRatio(readSurfaceDevicePixelRatio());wake()})
  wake()
  return connection
}

export function CaptureSource({ capture, adopt, size, resolution = 'auto', onError }: {
  capture: CaptureHandle; adopt: HTMLElement | null; size: SurfaceSize
  resolution?: SurfaceResolution; onError?: (error: Error) => void
}) {
  const connection = useRef<CaptureConnection | null>(null)
  const sizeRef = useLatest(size)
  const resolutionRef = useLatest(resolution)
  const errorRef = useLatest(onError)
  const resolutionKey = Array.isArray(resolution) ? resolution.join(':') : resolution
  const [width, height] = size
  useLayoutEffect(() => {
    if (!adopt) return
    const current = connectCapture(capture, adopt, sizeRef.current, {
      resolution: resolutionRef.current, onError: error => errorRef.current?.(error),
    })
    connection.current = current
    return () => { current.dispose(); if (connection.current === current) connection.current = null }
  }, [capture, adopt, sizeRef, errorRef, resolutionRef])
  useLayoutEffect(() => connection.current?.setSize([width, height]), [width, height])
  useLayoutEffect(() => connection.current?.setResolution(resolutionRef.current), [resolutionKey, resolutionRef])
  return null
}

export function inspectCapture(handle:CaptureHandle) {const model=modelOf(handle);return {status:model.status,frame:model.frame,consumers:model.consumers}}
