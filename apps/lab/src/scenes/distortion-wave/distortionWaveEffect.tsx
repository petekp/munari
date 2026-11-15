// Wave presentation — ordered outgoing snapshots reveal successive native states.
// Content draws newest first; independent light draws above every state mask.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Color,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  RenderTarget,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import type { CaptureHandle } from '@petepetrash/munari'
import { createCaptureCopy, usePairedCapture } from '../../lib/pairedCapture'
import {
  createDistortionWaveMaterial,
  MAX_WAVES,
  MAX_WAVE_INSTANCES,
  type WavePalette,
} from './distortionWaveNodes'
import {
  createWaveSnapshot,
  waveTargetBounds,
} from './distortionWaveSnapshot'
import { createWaveMotion, type WaveTiming } from './distortionWaveLaw'

export interface WaveRequest extends WaveTiming {
  target: HTMLElement
  source: DOMRect
  local: boolean
  boxless: boolean
  x: number
  y: number
  intensity: number
  palette: WavePalette
  update: () => void
}
export interface WaveController {
  run: (request: WaveRequest) => void
}
interface WaveEffectProps {
  capture: CaptureHandle
  controller: WaveController
}
interface SurfaceBend {
  pull: number
  x: number
  y: number
  latest: number
}

interface ActiveWave {
  order: number
  bend: SurfaceBend
  phase: ReturnType<ReturnType<typeof createWaveMotion>['frame']>
  request: WaveRequest
  overlapping: boolean
  slot: number | null
  snapshotReady: boolean
  paired: boolean
  started: number | null
  bounds: DOMRect
  targetBounds: DOMRect
  left: number
  top: number
  motion: ReturnType<typeof createWaveMotion>
  radius: number
  background: Color
}

// Viewport-sized pulses have a separate bound because their fragments cover the whole screen.
const MAX_PAGE_WAVES = 3

function followTarget(wave: ActiveWave): boolean {
  if (!wave.request.target.isConnected) return false
  const current = wave.request.target.getBoundingClientRect()
  const { targetBounds, bounds } = wave
  const sameSize =
    current.width === targetBounds.width &&
    current.height === targetBounds.height
  if (!sameSize) return false
  wave.left = bounds.left + (current.left - targetBounds.left)
  wave.top = bounds.top + (current.top - targetBounds.top)
  return true
}

function motionFor(request: WaveRequest, target: DOMRect, bounds: DOMRect) {
  const pointRadius = Math.max(8, Math.min(bounds.width, bounds.height) * 0.08)
  const cropX = bounds.left - target.left
  const cropY = bounds.top - target.top
  return createWaveMotion(
    {
      width: bounds.width,
      height: bounds.height,
      local: request.local,
      sourceX:
        (request.local ? request.x - pointRadius : request.source.left) - cropX,
      sourceY:
        (request.local ? request.y - pointRadius : request.source.top) - cropY,
      sourceWidth: request.local ? pointRadius * 2 : request.source.width,
      sourceHeight: request.local ? pointRadius * 2 : request.source.height,
      touchX: request.x - cropX,
      touchY: request.y - cropY,
    },
    request,
  )
}

function writeWave(
  values: ReturnType<typeof createDistortionWaveMaterial>,
  index: number,
  wave: ActiveWave,
  content: boolean,
  atlasWidth: number,
) {
  const { phase, bend } = wave
  const p = values.parameters
  p.size.values[index].set(wave.bounds.width, wave.bounds.height)
  p.origin.values[index].set(phase.x, phase.y)
  p.background.values[index].set(
    wave.background.r,
    wave.background.g,
    wave.background.b,
  )
  p.radius.values[index] = wave.radius
  p.boxless.values[index] = wave.request.boxless ? 1 : 0
  p.visibility.values[index] = !content && wave.overlapping ? 0.65 : 1
  p.content.values[index] = content ? 1 : 0
  p.light.values[index] = content ? 0 : 1
  p.sampled.values[index] = wave.slot === null ? 0 : 1
  p.snapshotIndex.values[index] = wave.slot ?? 0
  p.paired.values[index] = wave.paired ? 1 : 0
  p.incoming.values[index] = bend.latest === wave.order ? 1 : 0
  p.atlasInset.values[index] = 0.5 / atlasWidth
  p.scale.values[index] = wave.motion.scale
  p.ring.values[index] = wave.motion.ring ? 1 : 0
  p.amplitude.values[index] = wave.motion.amplitude * wave.request.intensity
  p.lensWidth.values[index] = wave.motion.lensWidth
  p.aberration.values[index] = wave.motion.aberration * wave.request.intensity
  p.lead.values[index] = wave.motion.lead
  p.tail.values[index] = wave.motion.tail
  p.rimWidth.values[index] = wave.motion.rimWidth
  p.rimSoftness.values[index] = wave.motion.rimSoftness
  p.seam.values[index] = wave.motion.seam
  p.time.values[index] = phase.time
  p.tilt.values[index] = phase.tilt
  p.squash.values[index] = phase.squash
  p.spine.values[index] = phase.spine
  p.front.values[index] = phase.radius
  p.swell.values[index] = phase.swell
  p.energy.values[index] = phase.energy
  p.pull.values[index] = bend.pull
  p.pullOrigin.values[index].set(bend.x, bend.y)
  p.glow.values[index] = phase.glow
  p.rim.values[index] = phase.rim
  p.clear.values[index] = phase.clear
  p.hairClear.values[index] = phase.hairClear
  p.launched.values[index] = phase.launched
  values.setPalette(index, wave.request.palette)
}

export function DistortionWaveEffect({ capture, controller }: WaveEffectProps) {
  const invalidate = useThree((state) => state.invalidate)
  const viewport = useThree((state) => state.viewport)
  const gl = useThree((state) => state.gl)
  if (!(gl instanceof WebGPURenderer))
    throw new Error('Wave rendering requires SurfaceCanvas')
  const mesh = useRef<InstancedMesh>(null)
  const active = useRef<ActiveWave[]>([])
  const owner = useRef<ActiveWave | null>(null)
  const { busy, start, cancel: cancelCapture, dispose, read, presented, source } = usePairedCapture(capture, invalidate)
  const requests = useRef<WaveRequest[]>([])
  const sequence = useRef(0)
  const warmed = useRef(false)
  const [resources] = useState(() => {
    const targets = Array.from(
      { length: MAX_WAVES },
      () => new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }),
    )
    return {
      targets,
      copy: createCaptureCopy(),
      geometry: new PlaneGeometry(),
      pose: new Matrix4(),
      wave: createDistortionWaveMaterial(
        targets.map((target) => target.texture),
      ),
    }
  })

  useEffect(
    () => () => {
      for (const target of resources.targets) target.dispose()
      resources.copy.dispose()
      resources.geometry.dispose()
      resources.wave.material.dispose()
    },
    [resources],
  )

  const releaseSnapshot = useCallback(
    (wave: ActiveWave) => {
      if (wave.slot === null) return
      resources.targets[wave.slot].setSize(1, 1)
      wave.slot = null
    },
    [resources],
  )

  const retire = useCallback(
    (wave: ActiveWave) => {
      if (owner.current === wave) {
        cancelCapture()
        return
      }
      active.current = active.current.filter((current) => current !== wave)
      releaseSnapshot(wave)
      invalidate()
    },
    [cancelCapture, invalidate, releaseSnapshot],
  )

  const prepare = useCallback(() => {
    if (busy() || requests.current.length === 0) return
    const request = requests.current[0]
    const pages = active.current.filter(
      (wave) =>
        wave.slot !== null &&
        wave.request.target.hasAttribute('data-wave-page'),
    )
    if (
      request.target.hasAttribute('data-wave-page') &&
      pages.length >= MAX_PAGE_WAVES
    )
      return
    const slot = resources.targets.findIndex(
      (_, index) => !active.current.some((wave) => wave.slot === index),
    )
    if (slot === -1) return
    if (active.current.length >= MAX_WAVES) {
      const finished = active.current.find((wave) => wave.slot === null)
      if (!finished) return
      retire(finished)
    }
    requests.current.shift()
    const targetBounds = request.target.getBoundingClientRect()
    const bounds = waveTargetBounds(request.target, targetBounds)
    if (!bounds) {
      flushSync(request.update)
      invalidate()
      return
    }
    const nextSnapshot = createWaveSnapshot(request.target, ++sequence.current)
    if (!nextSnapshot) {
      flushSync(request.update)
      invalidate()
      return
    }
    const motion = motionFor(request, targetBounds, bounds)
    const radius =
      Number.parseFloat(getComputedStyle(request.target).borderTopLeftRadius) ||
      0
    const paired =
      radius > 0 &&
      !request.boxless &&
      request.buildupDuration > 0 &&
      request.buildupDisplacement > 0
    const bend = active.current.find(
      (wave) => wave.request.target === request.target,
    )?.bend ?? { pull: 0, x: motion.pullX, y: motion.pullY, latest: 0 }
    const wave: ActiveWave = {
      order: sequence.current,
      bend,
      phase: motion.frame(0),
      request,
      overlapping: active.current.length > 0,
      slot,
      snapshotReady: false,
      paired,
      started: null,
      bounds,
      targetBounds,
      left: bounds.left,
      top: bounds.top,
      motion,
      radius,
      background: nextSnapshot.background,
    }
    active.current.push(wave)
    owner.current = wave
    const target = resources.targets[slot]
    start({
      before: nextSnapshot,
      update: request.update,
      after: paired ? () => {
        const incoming = createWaveSnapshot(request.target, ++sequence.current)
        return incoming?.bounds.width === bounds.width &&
          incoming.bounds.height === bounds.height ? incoming : null
      } : undefined,
      copy: (frame, side) => {
        const columns = paired ? 2 : 1
        const incoming = side === 'after'
        if (!incoming) {
          target.setSize(
            columns * Math.min(4096 / columns, Math.ceil(frame.width * gl.getPixelRatio())),
            Math.min(4096, Math.ceil(frame.height * gl.getPixelRatio())),
          )
        }
        const tileWidth = target.width / columns
        target.viewport.set(incoming ? tileWidth : 0, 0, tileWidth, target.height)
        resources.copy.render(gl, target, frame.texture, !incoming)
        if (!incoming) {
          wave.snapshotReady = true
          wave.bend.latest = wave.order
        }
      },
      ready: () => {
        owner.current = null
        wave.started = performance.now()
        invalidate()
      },
      abort: () => {
        owner.current = null
        retire(wave)
      },
    })
  }, [busy, gl, invalidate, resources, retire, start])

  useLayoutEffect(() => {
    const queuedRequests = requests.current
    const cancel = () => {
      for (const wave of [...active.current]) retire(wave)
      for (const request of requests.current.splice(0))
        flushSync(request.update)
    }
    controller.run = (request) => {
      requests.current.push(request)
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      if (reduced) cancel()
      else prepare()
      invalidate()
    }
    window.addEventListener('resize', cancel)
    return () => {
      controller.run = (request) => request.update()
      window.removeEventListener('resize', cancel)
      dispose()
      for (const request of queuedRequests.splice(0)) request.update()
      owner.current = null
      active.current = []
    }
  }, [controller, dispose, invalidate, prepare, retire])

  const sampleActiveWaves = (now: number, reduced: boolean) => {
    const sharedPulls = new Map<SurfaceBend, number>()
    for (const wave of [...active.current]) {
      const ended =
        wave.started !== null && now - wave.started >= wave.request.duration
      if (ended || reduced || !followTarget(wave)) {
        retire(wave)
        continue
      }
      const progress =
        wave.started === null ? 0 : (now - wave.started) / wave.request.duration
      const phase = wave.motion.frame(progress)
      wave.phase = phase
      const previous = sharedPulls.get(wave.bend) ?? 0
      if (previous === 0 && wave.bend.pull === 0 && phase.pull > 0) {
        wave.bend.x = wave.motion.pullX
        wave.bend.y = wave.motion.pullY
      }
      sharedPulls.set(wave.bend, Math.max(previous, phase.pull))
    }
    for (const [bend, pull] of sharedPulls) bend.pull = pull
    for (const wave of active.current) {
      const { phase, bend } = wave
      const needsInk = wave.request.boxless && phase.glow > 0
      const needsIncoming =
        wave.paired && bend.latest === wave.order && bend.pull > 0
      if (phase.revealed && !needsIncoming && !needsInk) releaseSnapshot(wave)
    }
  }

  useFrame(({ size }) => {
    if (!mesh.current) return
    const element = mesh.current
    if (!warmed.current) {
      for (const target of resources.targets) resources.copy.render(gl, target)
      resources.wave.upload()
      element.count = 1
      element.setMatrixAt(0, resources.pose.identity())
      element.instanceMatrix.needsUpdate = true
      element.visible = true
      invalidate()
      return
    }
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    sampleActiveWaves(performance.now(), reduced)
    if (reduced) {
      for (const request of requests.current.splice(0))
        flushSync(request.update)
    }
    read()
    const drawing = active.current.filter((wave) => wave.snapshotReady)
    const content = drawing.filter((wave) => wave.slot !== null).reverse()
    const instances = [...content, ...drawing]
    resources.wave.pixelRatio.value = gl.getPixelRatio()
    instances.forEach((wave, index) => {
      const atlasWidth =
        wave.slot === null ? 1 : resources.targets[wave.slot].width
      writeWave(resources.wave, index, wave, index < content.length, atlasWidth)
      const bounds = wave.bounds
      resources.pose.makeScale(
        (bounds.width * viewport.width) / size.width,
        (bounds.height * viewport.height) / size.height,
        1,
      )
      resources.pose.setPosition(
        ((wave.left + bounds.width / 2 - size.width / 2) * viewport.width) /
          size.width,
        ((size.height / 2 - wave.top - bounds.height / 2) * viewport.height) /
          size.height,
        0,
      )
      element.setMatrixAt(index, resources.pose)
    })
    resources.wave.upload()
    element.count = instances.length
    element.instanceMatrix.needsUpdate = true
    element.visible = drawing.length > 0
    if (drawing.length > 0 || requests.current.length > 0) invalidate()
    prepare()
  })

  return (
    <>
      {source}
      <instancedMesh
        ref={mesh}
        args={[resources.geometry, resources.wave.material, MAX_WAVE_INSTANCES]}
        visible={false}
        frustumCulled={false}
        onAfterRender={(renderer, _scene, _camera, _geometry, material) => {
          if (!warmed.current) {
            warmed.current = true
            if (mesh.current) mesh.current.visible = false
            invalidate()
            return
          }
          if (owner.current && mesh.current?.count && material === resources.wave.material)
            presented(renderer.getRenderTarget(), material.colorWrite)
        }}
      />
    </>
  )
}
