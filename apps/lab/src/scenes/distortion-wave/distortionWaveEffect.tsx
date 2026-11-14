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
  Texture,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import {
  useCaptureFrame,
  useCaptureStatus,
  type ElementCapture,
} from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import {
  createDistortionWaveMaterial,
  WAVE_PALETTES,
  type WavePalette,
} from './distortionWaveNodes'

export interface WaveRequest {
  target: HTMLElement
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
  capture: ElementCapture
  controller: WaveController
}
interface ActiveWave {
  request: WaveRequest
  committed: boolean
  snapshotReady: boolean
  started: number | null
  timeout: ReturnType<typeof setTimeout>
  bounds: DOMRect
}

export function DistortionWaveEffect({ capture, controller }: WaveEffectProps) {
  const frames = useCaptureFrame(capture)
  const status = useCaptureStatus(capture)
  const invalidate = useThree((state) => state.invalidate)
  const viewport = useThree((state) => state.viewport)
  const mesh = useRef<Mesh>(null)
  const active = useRef<ActiveWave | null>(null)
  const lastSourceId = useRef<number | null>(null)
  const [resources] = useState(() => {
    const target = new RenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
    })
    const placeholder = new Texture()
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

  const commit = useCallback(
    (wave: ActiveWave) => {
      if (wave.committed) return
      wave.committed = true
      clearTimeout(wave.timeout)
      flushSync(() => {
        capture.ref(null)
        wave.request.update()
      })
      wave.started = performance.now()
    },
    [capture],
  )

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
      const bounds = request.target.getBoundingClientRect()
      const canCapture =
        request.target.isConnected && bounds.width > 0 && bounds.height > 0
      const canAnimate = canCapture && !interrupted && !reduceMotion
      if (!canAnimate) {
        flushSync(request.update)
        return
      }
      const wave: ActiveWave = {
        request,
        committed: false,
        snapshotReady: false,
        started: null,
        bounds,
        timeout: setTimeout(() => {
          if (active.current === wave) finish()
        }, 1000),
      }
      const values = resources.wave
      values.size.value.set(bounds.width, bounds.height)
      values.box.value.set(0, 0, bounds.width, bounds.height)
      values.origin.value.set(request.x - bounds.left, request.y - bounds.top)
      values.radius.value =
        Number.parseFloat(
          getComputedStyle(request.target).borderTopLeftRadius,
        ) || 0
      values.progress.value = 0
      values.intensity.value = request.intensity
      values.colors.forEach((color, index) =>
        color.value.set(WAVE_PALETTES[request.palette][index]),
      )
      active.current = wave
      flushSync(() => capture.ref(request.target))
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
      capture.ref(null)
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
    const wave = active.current
    if (!wave) {
      element.visible = false
      return
    }
    const target = wave.request.target
    const bounds = target.getBoundingClientRect()
    const moved =
      !target.isConnected ||
      bounds.width !== wave.bounds.width ||
      bounds.height !== wave.bounds.height ||
      bounds.top !== wave.bounds.top ||
      bounds.left !== wave.bounds.left
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
      const fresh = frame && frame.sourceId !== lastSourceId.current
      const matchesTarget =
        frame &&
        frame.width === target.offsetWidth &&
        frame.height === target.offsetHeight
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
    if (wave.started !== null)
      resources.wave.progress.value = Math.min(
        1,
        (performance.now() - wave.started) / wave.request.duration,
      )
    if (resources.wave.progress.value >= 1) {
      finish()
      return
    }
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
    <mesh
      ref={mesh}
      visible={false}
      frustumCulled={false}
      onAfterRender={() => {
        const wave = active.current
        if (!wave || wave.committed) return
        queueMicrotask(() => {
          if (active.current === wave) commit(wave)
        })
      }}
    >
      <planeGeometry />
      <primitive object={resources.wave.material} attach="material" />
    </mesh>
  )
}
