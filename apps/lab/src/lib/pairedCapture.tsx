// Captured state transitions — the outgoing pixels cover the live update.
// Effects own their textures and geometry. The capture handle lends a frame only long enough to copy it.
import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  CaptureContent,
  useCaptureFrame,
  useCaptureStatus,
  type CaptureHandle,
} from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import {
  DataTexture,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type RenderTarget,
  type Texture,
} from 'three'
import { texture } from 'three/tsl'
import type { WebGPURenderer } from 'three/webgpu'
import { readSurfaceFrame, uploadSurfaceFrame } from './surfaceFrames'

type CaptureFrame = NonNullable<ReturnType<ReturnType<typeof useCaptureFrame>['get']>>
type Side = 'before' | 'after'

export interface TransitionSnapshot {
  element: HTMLElement
  size: readonly [number, number]
  anchor: string
}

interface CaptureJob {
  before: TransitionSnapshot
  update: () => void
  after?: () => TransitionSnapshot | null
  copy: (frame: CaptureFrame, side: Side) => void
  ready: () => void
  abort: () => void
}

interface PendingCapture {
  job: CaptureJob
  snapshot: TransitionSnapshot
  phase: 'capture-before' | 'present-before' | 'capture-after'
  settledSourceId?: number
  timeout: ReturnType<typeof setTimeout>
}

export function usePairedCapture(capture: CaptureHandle, invalidate: () => void) {
  const frames = useCaptureFrame(capture)
  const status = useCaptureStatus(capture)
  const pending = useRef<PendingCapture | null>(null)
  const lastSourceId = useRef<number | null>(null)
  const [snapshot, setSnapshot] = useState<TransitionSnapshot | null>(null)

  const clear = useCallback(() => {
    const current = pending.current
    if (!current) return
    clearTimeout(current.timeout)
    pending.current = null
    setSnapshot(null)
  }, [])

  const cancel = useCallback(() => {
    const current = pending.current
    if (!current) return
    clear()
    if (current.phase !== 'capture-after') flushSync(current.job.update)
    current.job.abort()
  }, [clear])

  const request = useCallback((job: CaptureJob, source: TransitionSnapshot, phase: PendingCapture['phase']) => {
    const current = { job, snapshot: source, phase, timeout: setTimeout(() => {
      if (pending.current === current) cancel()
    }, 1000) }
    pending.current = current
    setSnapshot(source)
    invalidate()
  }, [cancel, invalidate])

  const start = useCallback((job: CaptureJob) => {
    if (pending.current) return false
    request(job, job.before, 'capture-before')
    return true
  }, [request])

  const busy = useCallback(() => pending.current !== null, [])

  const dispose = useCallback(() => {
    const current = pending.current
    if (!current) return
    clearTimeout(current.timeout)
    pending.current = null
    if (current.phase !== 'capture-after') current.job.update()
  }, [])

  const read = (renderer: WebGPURenderer) => {
    const current = pending.current
    if (!current || current.phase === 'present-before') return
    if (status.status === 'error' || status.status === 'unsupported') {
      queueMicrotask(() => {
        if (pending.current === current) cancel()
      })
      return
    }
    const frame = frames.get()
    const source = current.snapshot
    const matches = frame && frame.sourceId !== lastSourceId.current &&
      frame.anchors[source.anchor] !== undefined &&
      frame.width === source.size[0] && frame.height === source.size[1]
    if (!matches) return
    const sampled = readSurfaceFrame(frame.texture)
    const samePaint = sampled?.paint.frame.sourceId === frame.sourceId &&
      sampled.paint.frame.generation === frame.generation
    if (samePaint && sampled.drawTrailsPaint && current.settledSourceId !== frame.sourceId) {
      current.settledSourceId = frame.sourceId
      invalidate()
      return
    }
    if (!samePaint || !uploadSurfaceFrame(sampled, renderer)) {
      invalidate()
      return
    }
    const incoming = current.phase === 'capture-after'
    current.job.copy(frame, incoming ? 'after' : 'before')
    lastSourceId.current = frame.sourceId
    if (incoming) {
      clear()
      current.job.ready()
    } else {
      current.phase = 'present-before'
    }
  }

  const presented = (target: RenderTarget | null, colorWrite: boolean) => {
    const current = pending.current
    if (target !== null || !colorWrite || current?.phase !== 'present-before') return
    queueMicrotask(() => {
      if (pending.current !== current || current.phase !== 'present-before') return
      current.phase = 'capture-after'
      flushSync(current.job.update)
      if (pending.current !== current) return
      const after = current.job.after
      const incoming = after?.()
      clear()
      if (incoming) request(current.job, incoming, 'capture-after')
      else if (after) current.job.abort()
      else current.job.ready()
    })
  }

  const source = snapshot && (
    <CaptureContent key={snapshot.anchor} capture={capture} element={snapshot.element} size={snapshot.size} />
  )
  return { start, cancel, dispose, busy, read, presented, source }
}

export function createCaptureCopy() {
  const placeholder = new DataTexture(new Uint8Array(4), 1, 1)
  placeholder.needsUpdate = true
  placeholder.colorSpace = SRGBColorSpace
  const map = texture(placeholder)
  const material = passMaterial()
  material.outputNode = map
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  return {
    render(gl: WebGPURenderer, target: RenderTarget, source?: Texture, clear = true) {
      const previous = gl.getRenderTarget()
      const autoClear = gl.autoClear
      gl.autoClear = clear
      map.value = source ?? placeholder
      gl.setRenderTarget(target)
      try {
        gl.render(scene, camera)
      } finally {
        gl.setRenderTarget(previous)
        gl.autoClear = autoClear
        map.value = placeholder
      }
    },
    dispose() {
      material.dispose()
      geometry.dispose()
      placeholder.dispose()
    },
  }
}
