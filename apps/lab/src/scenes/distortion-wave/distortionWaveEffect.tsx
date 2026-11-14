// Wave presentation — native controls keep their state and input throughout the effect.
// The first opaque draw precedes the update; interruption commits each action once.
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
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { texture } from 'three/tsl'
import {
  useCaptureFrame,
  type CaptureFrame,
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
  started: number | null
  timeout: ReturnType<typeof setTimeout>
  bounds: DOMRect
}

export function DistortionWaveEffect({ capture, controller }: WaveEffectProps) {
  const frames = useCaptureFrame(capture)
  const invalidate = useThree((state) => state.invalidate)
  const viewport = useThree((state) => state.viewport)
  const mesh = useRef<Mesh>(null)
  const active = useRef<ActiveWave | null>(null)
  const cachedFrame = useRef<CaptureFrame | null>(null)
  const cacheReady = useRef(false)
  const [resources] = useState(() => {
    const target = new RenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
    })
    const copy = passMaterial()
    const map = texture(target.texture)
    copy.outputNode = map
    const geometry = new PlaneGeometry(2, 2)
    const scene = new Scene()
    scene.add(new Mesh(geometry, copy))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const wave = createDistortionWaveMaterial(target.texture)
    return { target, copy, map, geometry, scene, camera, wave }
  })

  useEffect(
    () => () => {
      resources.target.dispose()
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
      flushSync(wave.request.update)
      capture.refresh()
    },
    [capture],
  )

  const finish = useCallback(() => {
    const wave = active.current
    if (wave) commit(wave)
    active.current = null
    if (mesh.current) mesh.current.visible = false
    invalidate()
  }, [commit, invalidate])

  useLayoutEffect(() => {
    const run = (request: WaveRequest) => {
      const bounds = capture.getBounds()
      const interrupted = active.current !== null
      if (interrupted) finish()
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      const cached = cachedFrame.current
      const matchesCapture =
        bounds &&
        cached &&
        Math.round(bounds.width) === cached.width &&
        Math.round(bounds.height) === cached.height
      const canAnimate =
        cacheReady.current && matchesCapture && !interrupted && !reduceMotion
      if (!canAnimate) {
        flushSync(request.update)
        cacheReady.current = false
        capture.refresh()
        invalidate()
        return
      }
      const rect = request.target.getBoundingClientRect()
      const wave: ActiveWave = {
        request,
        committed: false,
        started: null,
        bounds,
        timeout: setTimeout(() => {
          if (active.current === wave) finish()
        }, 250),
      }
      const values = resources.wave
      values.size.value.set(bounds.width, bounds.height)
      values.box.value.set(
        rect.left - bounds.left,
        rect.top - bounds.top,
        rect.width,
        rect.height,
      )
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
      cacheReady.current = false
      invalidate()
    }
    controller.run = run
    const cancel = () => {
      cacheReady.current = false
      finish()
    }
    window.addEventListener('resize', cancel)
    window.addEventListener('scroll', cancel, true)
    return () => {
      controller.run = (request) => request.update()
      window.removeEventListener('resize', cancel)
      window.removeEventListener('scroll', cancel, true)
      const wave = active.current
      if (wave) {
        clearTimeout(wave.timeout)
        if (!wave.committed) {
          wave.committed = true
          wave.request.update()
        }
      }
      active.current = null
    }
  }, [capture, controller, finish, invalidate, resources])

  useFrame(({ gl, size }) => {
    if (!(gl instanceof WebGPURenderer)) return
    const element = mesh.current
    if (!element) return
    const wave = active.current
    if (!wave) {
      element.visible = false
      const frame = frames.get()
      if (!frame || frame === cachedFrame.current) return
      const width = Math.min(4096, Math.ceil(frame.width * gl.getPixelRatio()))
      const height = Math.min(
        4096,
        Math.ceil(frame.height * gl.getPixelRatio()),
      )
      resources.target.setSize(width, height)
      resources.map.value = frame.texture
      const previous = gl.getRenderTarget()
      gl.setRenderTarget(resources.target)
      gl.render(resources.scene, resources.camera)
      gl.setRenderTarget(previous)
      cachedFrame.current = frame
      cacheReady.current = true
      return
    }
    const bounds = capture.getBounds()
    const moved =
      !bounds ||
      bounds.width !== wave.bounds.width ||
      bounds.height !== wave.bounds.height ||
      bounds.top !== wave.bounds.top ||
      bounds.left !== wave.bounds.left
    if (
      moved ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      finish()
      return
    }
    if (wave.committed) {
      wave.started ??= performance.now()
      resources.wave.progress.value = Math.min(
        1,
        (performance.now() - wave.started) / wave.request.duration,
      )
    }
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
