// Host presentation — actual output pixels and receipts across skipped and unrelated passes.
// Caller-owned frames keep capture capability separate from this renderer boundary.

import { useLayoutEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync, useFrame } from '@react-three/fiber'
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu'
import * as THREE from 'three'
import { SurfaceCanvas } from '@petepetrash/munari'
import { FrameSurface, createCanvasFrameSource, useSurfaceOutput, type PresentationReceipt, type PresentationRequirement } from '@petepetrash/munari/advanced'

const query = new URLSearchParams(location.search)
const mode = query.get('mode') ?? 'direct'
const requestedBackend = query.get('backend') ?? 'webgpu'
const samples: { frame: number; pixel: number[] }[] = []
const presentations: { frame: number; receipt: PresentationReceipt }[] = []
let frames = 0
let armedFrames = 0
let backend = 'unknown'

const makeSource = (color: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Source context unavailable')
  context.fillStyle = color
  context.fillRect(0, 0, 16, 16)
  const source = createCanvasFrameSource(canvas, { premultiplyAlpha: false })
  source.publish()
  return source
}
const first = makeSource('#00ff00')
const second = makeSource('#0000ff')
const firstRequirement: PresentationRequirement = { frame: first.currentFrame(), transferId: 1, presentationRevision: 1 }
const readback = document.createElement('canvas')
readback.width = readback.height = 256
const readbackContext = readback.getContext('2d')
if (!readbackContext) throw new Error('Readback context unavailable')
const pixel = (renderer: WebGPURenderer) => {
  readbackContext.clearRect(0, 0, 256, 256)
  readbackContext.drawImage(renderer.domElement, 0, 0)
  return Array.from(readbackContext.getImageData(128, 128, 1, 1).data)
}

function changeTargetBeforeOutput(renderer: WebGPURenderer, empty: THREE.Scene, camera: THREE.Camera) {
  if (mode === 'auto-clear' || mode === 'no-clear' || mode === 'background-clear') {
    const autoClear = renderer.autoClear
    if (mode !== 'auto-clear') renderer.autoClear = false
    if (mode === 'background-clear') empty.background = new THREE.Color('#ff0000')
    renderer.render(empty, camera)
    renderer.autoClear = autoClear
  }
  if (mode === 'clear') renderer.clear()
  if (mode === 'depth-clear') renderer.clear(false, true, false)
  if (['callback-clear', 'callback-color-clear', 'callback-background-clear'].includes(mode)) {
    const autoClear = renderer.autoClear
    const autoClearColor = renderer.autoClearColor
    if (mode === 'callback-color-clear') renderer.autoClearColor = false
    else renderer.autoClear = false
    const replacement = () => {}
    const before: THREE.Scene['onBeforeRender'] = function (this: THREE.Scene, gl) {
      if (this !== empty || !(gl instanceof WebGPURenderer)) throw new Error('Scene callback binding changed')
      if (mode === 'callback-clear') { gl.autoClear = true; this.onBeforeRender = replacement }
      if (mode === 'callback-color-clear') gl.autoClearColor = true
      if (mode === 'callback-background-clear') this.background = new THREE.Color('#ff0000')
    }
    empty.onBeforeRender = before
    renderer.render(empty, camera)
    if (empty.onBeforeRender !== (mode === 'callback-clear' ? replacement : before)) throw new Error('Scene callback replacement was lost')
    renderer.autoClear = autoClear
    renderer.autoClearColor = autoClearColor
  }
}

function Scene() {
  const [armed, setArmed] = useState(false)
  const [source, setSource] = useState(first)
  const [requirement, setRequirement] = useState(firstRequirement)
  const [mounted, setMounted] = useState(true)
  const target = useMemo(() => new THREE.RenderTarget(256, 256), [])
  const empty = useMemo(() => new THREE.Scene(), [])
  const output = useMemo(() => {
    const material = new MeshBasicNodeMaterial({ map: target.texture, toneMapped: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    const scene = new THREE.Scene()
    const override = new MeshBasicNodeMaterial({ color: '#ff0000' })
    let prelude: THREE.Mesh<THREE.PlaneGeometry, MeshBasicNodeMaterial> | null = null
    scene.add(mesh)
    if (mode === 'color-off') material.colorWrite = false
    if (mode === 'empty') mesh.geometry.setDrawRange(0, 0)
    if (mode === 'override') scene.overrideMaterial = override
    if (mode === 'nested-auto-clear') {
      prelude = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false }))
      prelude.renderOrder = -1
      prelude.onBeforeRender = (renderer, _scene, camera) => {
        if (!(renderer instanceof WebGPURenderer)) throw new Error('Unexpected renderer')
        const previousTarget = renderer.getRenderTarget()
        renderer.setRenderTarget(target)
        renderer.render(empty, camera)
        renderer.setRenderTarget(previousTarget)
      }
      scene.add(prelude)
    }
    return { scene, mesh, material, override, prelude }
  }, [target, empty])
  const handlers = useSurfaceOutput([target])
  useLayoutEffect(() => {
    output.mesh.onBeforeRender = handlers.onBeforeRender
    output.mesh.onAfterRender = handlers.onAfterRender
  }, [output, handlers])
  useLayoutEffect(() => () => {
    target.dispose()
    output.mesh.geometry.dispose()
    output.material.dispose()
    output.override.dispose()
    output.prelude?.geometry.dispose()
    output.prelude?.material.dispose()
  }, [target, output])
  useFrame(({ gl, scene, camera }) => {
    if (!(gl instanceof WebGPURenderer)) throw new Error('SurfaceCanvas did not supply WebGPURenderer')
    if ('isWebGPUBackend' in gl.backend && gl.backend.isWebGPUBackend === true) backend = 'webgpu'
    else if ('isWebGLBackend' in gl.backend && gl.backend.isWebGLBackend === true) backend = 'webgl2'
    if (samples.length >= 4) return
    frames++
    if (!armed) {
      gl.setRenderTarget(null)
      gl.render(scene, camera)
      if (frames === 20) setArmed(true)
      return
    }
    armedFrames++
    if (armedFrames === 1 && mode !== 'direct') {
      gl.setRenderTarget(target)
      gl.render(scene, camera)
      changeTargetBeforeOutput(gl, empty, camera)
      gl.setRenderTarget(null)
      if (mode === 'source-change') flushSync(() => {
        setSource(second)
        setRequirement({ frame: second.currentFrame(), transferId: 1, presentationRevision: 1 })
      })
      if (mode === 'requirement-change') flushSync(() => setRequirement({ ...firstRequirement, presentationRevision: 2 }))
      if (mode === 'unmount') flushSync(() => setMounted(false))
      if (mode === 'unrelated') gl.render(empty, camera)
      else if (mode !== 'discard') gl.render(output.scene, camera)
    } else {
      gl.setRenderTarget(null)
      gl.render(scene, camera)
    }
    samples.push({ frame: armedFrames, pixel: pixel(gl) })
  }, 1)
  return mounted ? <FrameSurface name="host-presentation-source" frame={source} presentation={armed ? requirement : undefined} raycast={() => {}} onPresented={receipt => presentations.push({ frame: armedFrames, receipt })}><planeGeometry args={[2, 2]} /></FrameSurface> : null
}

declare global {
  interface Window {
    __hostPresentation: { result(): { mode: string; requestedBackend: string; backend: string; samples: typeof samples; presentations: typeof presentations; complete: boolean } }
  }
}
window.__hostPresentation = { result: () => ({ mode, requestedBackend, backend, samples, presentations, complete: samples.length === 4 }) }
createRoot(document.getElementById('root')!).render(<SurfaceCanvas id="host-presentation" dpr={1} camera={{ position: [0, 0, 3] }} gl={{ alpha: true, antialias: false, forceWebGL: requestedBackend === 'webgl2' }}><Scene /></SurfaceCanvas>)
