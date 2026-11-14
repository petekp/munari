// Wave presentation — isolated transitions borrow one snapshot; bursts layer light over live HTML.
// Every action commits once. Instances keep independent clocks without repeating DOM capture.
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
  DataTexture,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SRGBColorSpace,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import {
  CaptureContent,
  useCaptureFrame,
  useCaptureStatus,
  type CaptureHandle,
} from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import {
  createDistortionWaveMaterial,
  MAX_WAVES,
  type WavePalette,
} from './distortionWaveNodes'
import {
  createWaveSnapshot,
  waveTargetBounds,
  type WaveSnapshot,
} from './distortionWaveSnapshot'
import { createWaveMotion } from './distortionWaveLaw'

export interface WaveRequest {
  target: HTMLElement
  source: DOMRect
  local: boolean
  boxless: boolean
  x: number
  y: number
  duration: number
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
interface ActiveWave {
  request: WaveRequest
  committed: boolean
  additive: boolean
  snapshotReady: boolean
  created: number
  started: number | null
  timeout: ReturnType<typeof setTimeout> | null
  bounds: DOMRect
  targetBounds: DOMRect
  snapshot: WaveSnapshot | null
  motion: ReturnType<typeof createWaveMotion>
  radius: number
  background: Color
}

// Viewport-sized pulses have a separate bound because their fragments cover the whole screen.
const MAX_PAGE_WAVES = 3

function boundsMatch(a: DOMRect, b: DOMRect): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.top === b.top &&
    a.left === b.left
  )
}

function motionFor(request: WaveRequest, bounds: DOMRect) {
  const pointRadius = Math.max(8, Math.min(bounds.width, bounds.height) * 0.08)
  return createWaveMotion({
    width: bounds.width,
    height: bounds.height,
    local: request.local,
    sourceX:
      (request.local ? request.x - pointRadius : request.source.left) -
      bounds.left,
    sourceY:
      (request.local ? request.y - pointRadius : request.source.top) -
      bounds.top,
    sourceWidth: request.local ? pointRadius * 2 : request.source.width,
    sourceHeight: request.local ? pointRadius * 2 : request.source.height,
    touchX: request.x - bounds.left,
    touchY: request.y - bounds.top,
  })
}

function writeWave(
  values: ReturnType<typeof createDistortionWaveMaterial>,
  index: number,
  wave: ActiveWave,
  now: number,
) {
  const progress =
    wave.started === null
      ? 0
      : Math.min(1, (now - wave.started) / wave.request.duration)
  const phase = wave.motion.frame(progress)
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
  p.visibility.values[index] = wave.additive ? 0.65 : 1
  p.content.values[index] = wave.additive ? 0 : 1
  p.sampled.values[index] = wave.additive ? 0 : 1
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
  p.glow.values[index] = phase.glow
  p.rim.values[index] = phase.rim
  p.clear.values[index] = phase.clear
  p.hairClear.values[index] = phase.hairClear
  p.launched.values[index] = phase.launched
  values.setPalette(index, wave.request.palette)
}

export function DistortionWaveEffect({ capture, controller }: WaveEffectProps) {
  const frames = useCaptureFrame(capture)
  const status = useCaptureStatus(capture)
  const invalidate = useThree((state) => state.invalidate)
  const viewport = useThree((state) => state.viewport)
  const gl = useThree((state) => state.gl)
  if (!(gl instanceof WebGPURenderer))
    throw new Error('Wave rendering requires SurfaceCanvas')
  const mesh = useRef<InstancedMesh>(null)
  const active = useRef<ActiveWave[]>([])
  const pending = useRef<ActiveWave | null>(null)
  const lastSourceId = useRef<number | null>(null)
  const sequence = useRef(0)
  const warmed = useRef(false)
  const [snapshot, setSnapshot] = useState<WaveSnapshot | null>(null)
  const [resources] = useState(() => {
    const target = new RenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
    })
    const placeholder = new DataTexture(new Uint8Array(4), 1, 1)
    placeholder.needsUpdate = true
    placeholder.colorSpace = SRGBColorSpace
    const copy = passMaterial(),
      map = texture(placeholder)
    copy.outputNode = map
    const copyGeometry = new PlaneGeometry(2, 2),
      geometry = new PlaneGeometry()
    const scene = new Scene()
    scene.add(new Mesh(copyGeometry, copy))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    return {
      target,
      placeholder,
      copy,
      map,
      copyGeometry,
      geometry,
      scene,
      camera,
      pose: new Matrix4(),
      wave: createDistortionWaveMaterial(target.texture),
    }
  })

  useEffect(
    () => () => {
      resources.target.dispose()
      resources.placeholder.dispose()
      resources.copy.dispose()
      resources.copyGeometry.dispose()
      resources.geometry.dispose()
      resources.wave.material.dispose()
    },
    [resources],
  )

  const commit = useCallback((wave: ActiveWave) => {
    if (wave.committed) return
    wave.committed = true
    if (wave.timeout !== null) clearTimeout(wave.timeout)
    if (pending.current === wave) pending.current = null
    const ownedSnapshot = wave.snapshot
    setSnapshot((current) => (current === ownedSnapshot ? null : current))
    flushSync(wave.request.update)
    wave.started ??= performance.now()
  }, [])

  const retire = useCallback(
    (wave: ActiveWave) => {
      active.current = active.current.filter((current) => current !== wave)
      commit(wave)
      invalidate()
    },
    [commit, invalidate],
  )

  const addLight = useCallback(
    (wave: ActiveWave) => {
      wave.additive = true
      wave.snapshotReady = true
      wave.started ??=
        wave.created - wave.request.duration * wave.motion.launchProgress
      commit(wave)
      wave.snapshot = null
    },
    [commit],
  )

  useLayoutEffect(() => {
    controller.run = (request) => {
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      const burst = active.current.length > 0
      if (burst) for (const wave of active.current) addLight(wave)
      if (reduced || burst) flushSync(request.update)
      if (reduced) {
        for (const wave of [...active.current]) retire(wave)
        return
      }
      const targetBounds = request.target.getBoundingClientRect()
      const bounds = waveTargetBounds(request.target, targetBounds)
      if (!bounds) {
        if (!burst) flushSync(request.update)
        return
      }
      const nextSnapshot = burst
        ? null
        : createWaveSnapshot(request.target, ++sequence.current)
      if (!burst && !nextSnapshot) {
        flushSync(request.update)
        return
      }
      const motion = motionFor(request, bounds)
      const created = performance.now()
      const wave: ActiveWave = {
        request,
        committed: burst,
        additive: burst,
        snapshotReady: burst,
        created,
        started: burst
          ? created - request.duration * motion.launchProgress
          : null,
        timeout: null,
        bounds,
        targetBounds,
        snapshot: nextSnapshot,
        motion,
        radius:
          Number.parseFloat(
            getComputedStyle(request.target).borderTopLeftRadius,
          ) || 0,
        background: nextSnapshot?.background ?? new Color('#131316'),
      }
      if (request.target.hasAttribute('data-wave-page')) {
        const pages = active.current.filter((current) =>
          current.request.target.hasAttribute('data-wave-page'),
        )
        if (pages.length >= MAX_PAGE_WAVES) retire(pages[0])
      }
      if (active.current.length >= MAX_WAVES) retire(active.current[0])
      active.current.push(wave)
      if (nextSnapshot) {
        pending.current = wave
        setSnapshot(nextSnapshot)
        wave.timeout = setTimeout(() => {
          if (pending.current === wave) retire(wave)
        }, 1000)
      }
      invalidate()
    }
    const cancel = () => {
      for (const wave of [...active.current]) retire(wave)
    }
    window.addEventListener('resize', cancel)
    window.addEventListener('scroll', cancel, true)
    return () => {
      controller.run = (request) => request.update()
      window.removeEventListener('resize', cancel)
      window.removeEventListener('scroll', cancel, true)
      for (const wave of active.current) {
        if (wave.timeout !== null) clearTimeout(wave.timeout)
        if (!wave.committed) {
          wave.committed = true
          wave.request.update()
        }
      }
      pending.current = null
      active.current = []
    }
  }, [addLight, controller, invalidate, retire])

  useFrame(({ size }) => {
    if (!mesh.current) return
    const element = mesh.current
    if (!warmed.current) {
      const previous = gl.getRenderTarget()
      gl.setRenderTarget(resources.target)
      gl.render(resources.scene, resources.camera)
      gl.setRenderTarget(previous)
      resources.wave.upload()
      element.count = 1
      element.setMatrixAt(0, resources.pose.identity())
      element.instanceMatrix.needsUpdate = true
      element.visible = true
      invalidate()
      return
    }
    const now = performance.now()
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    for (const wave of [...active.current]) {
      const moved =
        !wave.request.target.isConnected ||
        !boundsMatch(
          wave.request.target.getBoundingClientRect(),
          wave.targetBounds,
        )
      const ended =
        wave.started !== null && now - wave.started >= wave.request.duration
      if (moved || ended || reduced) retire(wave)
    }
    const waiting = pending.current
    if (waiting && waiting.snapshot) {
      if (status.status === 'error' || status.status === 'unsupported')
        retire(waiting)
      else {
        const frame = frames.get()
        const fresh =
          frame &&
          frame.sourceId !== lastSourceId.current &&
          frame.anchors[waiting.snapshot.anchor] !== undefined
        const matched =
          frame &&
          frame.width === waiting.snapshot.size[0] &&
          frame.height === waiting.snapshot.size[1]
        if (fresh && matched) {
          resources.target.setSize(
            Math.min(4096, Math.ceil(frame.width * gl.getPixelRatio())),
            Math.min(4096, Math.ceil(frame.height * gl.getPixelRatio())),
          )
          resources.map.value = frame.texture
          const previous = gl.getRenderTarget()
          gl.setRenderTarget(resources.target)
          gl.render(resources.scene, resources.camera)
          gl.setRenderTarget(previous)
          resources.map.value = resources.placeholder
          lastSourceId.current = frame.sourceId
          waiting.snapshotReady = true
        }
      }
    }
    const drawing = active.current.filter((wave) => wave.snapshotReady)
    resources.wave.pixelRatio.value = gl.getPixelRatio()
    drawing.forEach((wave, index) => {
      writeWave(resources.wave, index, wave, now)
      const bounds = wave.bounds
      resources.pose.makeScale(
        (bounds.width * viewport.width) / size.width,
        (bounds.height * viewport.height) / size.height,
        1,
      )
      resources.pose.setPosition(
        ((bounds.left + bounds.width / 2 - size.width / 2) * viewport.width) /
          size.width,
        ((size.height / 2 - bounds.top - bounds.height / 2) * viewport.height) /
          size.height,
        0,
      )
      element.setMatrixAt(index, resources.pose)
    })
    resources.wave.upload()
    element.count = drawing.length
    element.instanceMatrix.needsUpdate = true
    element.visible = drawing.length > 0
    if (drawing.length > 0) invalidate()
  })

  return (
    <>
      {snapshot && (
        <CaptureContent
          key={snapshot.anchor}
          capture={capture}
          element={snapshot.element}
          size={snapshot.size}
        />
      )}
      <instancedMesh
        ref={mesh}
        args={[resources.geometry, resources.wave.material, MAX_WAVES]}
        visible={false}
        frustumCulled={false}
        onAfterRender={() => {
          if (!warmed.current) {
            warmed.current = true
            if (mesh.current) mesh.current.visible = false
            invalidate()
            return
          }
          const wave = pending.current
          if (!wave?.snapshotReady || wave.committed) return
          queueMicrotask(() => {
            if (pending.current === wave && active.current.includes(wave))
              commit(wave)
          })
        }}
      />
    </>
  )
}
