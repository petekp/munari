// Wave presentation — native controls keep their state and input throughout the effect.
// The overlay holds a target snapshot; the first opaque draw precedes the update.
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
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SRGBColorSpace,
  DataTexture,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import {
  useCaptureFrame,
  useCaptureStatus,
  CaptureContent,
  type CaptureHandle,
} from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import {
  createDistortionWaveMaterial,
  type WavePalette,
} from './distortionWaveNodes'
import { createWaveSnapshot, type WaveSnapshot } from './distortionWaveSnapshot'
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
  snapshotReady: boolean
  started: number | null
  timeout: ReturnType<typeof setTimeout>
  bounds: DOMRect
  targetBounds: DOMRect
  snapshot: WaveSnapshot
  motion: ReturnType<typeof createWaveMotion>
}

function boundsMatch(a: DOMRect, b: DOMRect): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.top === b.top &&
    a.left === b.left
  )
}

export function DistortionWaveEffect({ capture, controller }: WaveEffectProps) {
  const frames = useCaptureFrame(capture)
  const status = useCaptureStatus(capture)
  const invalidate = useThree((state) => state.invalidate)
  const viewport = useThree((state) => state.viewport)
  const mesh = useRef<Mesh>(null)
  const active = useRef<ActiveWave | null>(null)
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
    const copy = passMaterial()
    const map = texture(placeholder)
    copy.outputNode = map
    const geometry = new PlaneGeometry(2, 2)
    const scene = new Scene()
    scene.add(new Mesh(geometry, copy))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const wave = createDistortionWaveMaterial(target.texture)
    return { target, placeholder, copy, map, geometry, scene, camera, wave }
  })

  useEffect(
    () => () => {
      resources.target.dispose()
      resources.placeholder.dispose()
      resources.copy.dispose()
      resources.geometry.dispose()
      resources.wave.material.dispose()
    },
    [resources],
  )

  const commit = useCallback((wave: ActiveWave) => {
    if (wave.committed) return
    wave.committed = true
    clearTimeout(wave.timeout)
    setSnapshot(null)
    flushSync(wave.request.update)
    wave.started = performance.now()
  }, [])

  const finish = useCallback(() => {
    const wave = active.current
    active.current = null
    if (mesh.current) mesh.current.visible = false
    if (wave) commit(wave)
    invalidate()
  }, [commit, invalidate])

  useLayoutEffect(() => {
    controller.run = (request) => {
      const interrupted = active.current !== null
      if (interrupted) finish()
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      const targetBounds = request.target.getBoundingClientRect()
      const bounds = targetBounds
      const canCapture =
        request.target.isConnected && bounds.width > 0 && bounds.height > 0
      const canAnimate = canCapture && !reduceMotion
      if (!canAnimate) {
        flushSync(request.update)
        return
      }
      const nextSnapshot = createWaveSnapshot(
        request.target,
        ++sequence.current,
      )
      if (!nextSnapshot) { flushSync(request.update); return }
      const pointRadius = Math.max(
        8,
        Math.min(bounds.width, bounds.height) * 0.08,
      )
      const source = request.source
      const motion = createWaveMotion({
        width: nextSnapshot.size[0],
        height: nextSnapshot.size[1],
        local: request.local,
        sourceX:
          (request.local ? request.x - pointRadius : source.left) -
          nextSnapshot.bounds.left,
        sourceY:
          (request.local ? request.y - pointRadius : source.top) -
          nextSnapshot.bounds.top,
        sourceWidth: request.local ? pointRadius * 2 : source.width,
        sourceHeight: request.local ? pointRadius * 2 : source.height,
        touchX: request.x - nextSnapshot.bounds.left,
        touchY: request.y - nextSnapshot.bounds.top,
      })
      const wave: ActiveWave = {
        request,
        committed: false,
        snapshotReady: false,
        started: null,
        bounds: nextSnapshot.bounds,
        targetBounds,
        snapshot: nextSnapshot,
        motion,
        timeout: setTimeout(() => {
          if (active.current === wave) finish()
        }, 1000),
      }
      const values = resources.wave
      values.size.value.set(...nextSnapshot.size)
      values.radius.value =
        Number.parseFloat(
          getComputedStyle(request.target).borderTopLeftRadius,
        ) || 0
      values.boxless.value = request.boxless ? 1 : 0
      values.background.value.copy(nextSnapshot.background)
      values.setPalette(request.palette)
      values.scale.value = motion.scale
      values.ring.value = motion.ring ? 1 : 0
      values.amplitude.value = motion.amplitude * request.intensity
      values.lensWidth.value = motion.lensWidth
      values.aberration.value = motion.aberration * request.intensity
      values.lead.value = motion.lead
      values.tail.value = motion.tail
      values.rimWidth.value = motion.rimWidth
      values.rimSoftness.value = motion.rimSoftness
      values.seam.value = motion.seam
      active.current = wave
      setSnapshot(nextSnapshot)
      invalidate()
    }
    const cancel = () => finish()
    window.addEventListener('resize', cancel)
    window.addEventListener('scroll', cancel, true)
    return () => {
      controller.run = (request) => request.update()
      window.removeEventListener('resize', cancel)
      window.removeEventListener('scroll', cancel, true)
      const wave = active.current
      active.current = null
      if (wave) {
        clearTimeout(wave.timeout)
        if (!wave.committed) {
          wave.committed = true
          wave.request.update()
        }
      }
    }
  }, [capture, controller, finish, invalidate, resources])

  useFrame(({ gl, size }) => {
    if (!(gl instanceof WebGPURenderer)) return
    const element = mesh.current
    if (!element) return
    if (!warmed.current) {
      const previous = gl.getRenderTarget()
      gl.setRenderTarget(resources.target)
      gl.render(resources.scene, resources.camera)
      gl.setRenderTarget(previous)
      resources.wave.visibility.value = 0
      element.visible = true
      invalidate()
      return
    }
    const wave = active.current
    if (!wave) {
      element.visible = false
      return
    }
    const target = wave.request.target
    const currentBounds = target.getBoundingClientRect()
    const bounds = wave.bounds
    const moved =
      !target.isConnected || !boundsMatch(currentBounds, wave.targetBounds)
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (moved || reduceMotion) {
      finish()
      return
    }
    if (!wave.snapshotReady) {
      const failed =
        status.status === 'error' || status.status === 'unsupported'
      if (failed) {
        finish()
        return
      }
      const frame = frames.get()
      const fresh =
        frame &&
        frame.sourceId !== lastSourceId.current &&
        frame.anchors[wave.snapshot.anchor] !== undefined
      const matchesTarget =
        frame &&
        frame.width === wave.snapshot.size[0] &&
        frame.height === wave.snapshot.size[1]
      if (!fresh || !matchesTarget) return
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
      wave.snapshotReady = true
    }
    const progress =
      wave.started === null
        ? 0
        : Math.min(
            1,
            (performance.now() - wave.started) / wave.request.duration,
          )
    if (progress >= 1) {
      finish()
      return
    }
    const phase = wave.motion.frame(progress)
    const values = resources.wave
    values.origin.value.set(phase.x, phase.y)
    values.time.value = phase.time
    values.tilt.value = phase.tilt
    values.squash.value = phase.squash
    values.spine.value = phase.spine
    values.front.value = phase.radius
    values.swell.value = phase.swell
    values.energy.value = phase.energy
    values.glow.value = phase.glow
    values.rim.value = phase.rim
    values.clear.value = phase.clear
    values.hairClear.value = phase.hairClear
    values.launched.value = phase.launched
    values.pixelRatio.value = gl.getPixelRatio()
    values.visibility.value = 1
    element.position.set(
      ((bounds.left + bounds.width / 2 - size.width / 2) * viewport.width) /
        size.width,
      ((size.height / 2 - bounds.top - bounds.height / 2) * viewport.height) /
        size.height,
      0,
    )
    element.scale.set(
      (bounds.width * viewport.width) / size.width,
      (bounds.height * viewport.height) / size.height,
      1,
    )
    element.visible = true
    invalidate()
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
      <mesh
        ref={mesh}
        visible={false}
        frustumCulled={false}
        onAfterRender={() => {
          if (!warmed.current) {
            warmed.current = true
            if (mesh.current) mesh.current.visible = false
            invalidate()
            return
          }
          const wave = active.current
          if (!wave || !wave.snapshotReady || wave.committed) return
          queueMicrotask(() => {
            if (active.current === wave) commit(wave)
          })
        }}
      >
        <planeGeometry />
        <primitive object={resources.wave.material} attach="material" />
      </mesh>
    </>
  )
}
