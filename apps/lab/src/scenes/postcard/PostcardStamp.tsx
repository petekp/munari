// Stamp reveal — the live form stays on the page throughout the wipe.
// Capture at the card's layout size and place the wipe over its scaled viewport rectangle.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useCaptureHandle } from '@petepetrash/munari'
import { HalfFloatType, Mesh, PlaneGeometry, RenderTarget, Vector4 } from 'three'
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu'
import { mix, positionGeometry, smoothstep, texture, uniform, uv, vec2, vec4 } from 'three/tsl'
import { createCaptureCopy, usePairedCapture, type TransitionSnapshot } from '../../lib/pairedCapture'
import { PAPER_WIDTH, PAPER_HEIGHT } from '../light/lightPaperLaw'
import type { HolderRef } from './PostcardForm'

interface ActiveStamp {
  card: HTMLElement
  visible: boolean
  began: number | null
}

export interface StampController {
  stamp: (update: () => void) => void
  cancel: () => void
}

function stampSnapshot(card: HTMLElement, sequence: number): TransitionSnapshot {
  const element = document.createElement('div')
  element.className = 'light-theme light-inner'
  element.style.cssText = `width:${PAPER_WIDTH}px;height:${PAPER_HEIGHT}px;padding:0`
  // SAFETY: the card is an HTMLElement, and cloneNode preserves its type.
  const copy = card.cloneNode(true) as HTMLElement
  const anchor = `stamp-${sequence}`
  copy.setAttribute('data-munari-anchor', anchor)
  copy.querySelector('[id]')?.removeAttribute('id')
  const button = card.querySelector('button')
  const clonedButton = copy.querySelector('button')
  if (button && clonedButton) {
    const style = getComputedStyle(button)
    clonedButton.style.backgroundColor = style.backgroundColor
    clonedButton.style.color = style.color
    clonedButton.style.outline = style.outline
    clonedButton.style.outlineOffset = style.outlineOffset
  }
  const input = card.querySelector('input')
  const clonedInput = copy.querySelector('input')
  if (input && clonedInput) {
    clonedInput.value = input.value
    if (input === document.activeElement) {
      const style = getComputedStyle(input)
      clonedInput.style.outline = style.outline
      clonedInput.style.outlineOffset = style.outlineOffset
      clonedInput.style.borderBottomColor = style.borderBottomColor
    }
  }
  element.append(copy)
  return { element, size: [PAPER_WIDTH, PAPER_HEIGHT], anchor }
}

function stampResources() {
  const atlas = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const copy = createCaptureCopy()
  const geometry = new PlaneGeometry()
  const material = new MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, toneMapped: false })
  const rect = uniform(new Vector4())
  const progress = uniform(0)
  const inset = uniform(0.25)
  const map = texture(atlas.texture)
  const tile = vec2(uv().x.mul(0.5).clamp(inset, inset.oneMinus().sub(0.5)), uv().y)
  const before = map.sample(tile)
  const after = map.sample(tile.add(vec2(0.5, 0)))
  const edge = progress.mul(1.2).sub(uv().x)
  material.outputNode = mix(before, after, smoothstep(0.02, 0.16, edge))
  material.vertexNode = vec4(positionGeometry.xy.mul(rect.zw).add(rect.xy), 0.5, 1)
  return { atlas, copy, geometry, material, rect, progress, inset }
}

const STAMP_DURATION = 320
const ignoreRaycast = () => {}

export function PostcardStamp({ controller, holder }: { controller: StampController; holder: HolderRef }) {
  const gl = useThree(state => state.gl)
  const invalidate = useThree(state => state.invalidate)
  const capture = useCaptureHandle()
  const { start, cancel, dispose, read, presented, source } = usePairedCapture(capture, invalidate)
  const [resources] = useState(stampResources)
  const mesh = useRef<Mesh>(null)
  const sequence = useRef(0)
  const queue = useRef<Array<() => void>>([])
  const active = useRef<ActiveStamp | null>(null)
  if (!(gl instanceof WebGPURenderer)) throw new Error('Stamp rendering requires SurfaceCanvas')

  useEffect(() => () => {
    resources.atlas.dispose()
    resources.copy.dispose()
    resources.geometry.dispose()
    resources.material.dispose()
  }, [resources])

  useLayoutEffect(() => {
    const queued = queue.current
    const stop = () => {
      cancel()
      active.current = null
      if (mesh.current) mesh.current.visible = false
      for (const update of queued.splice(0)) update()
      invalidate()
    }
    controller.cancel = stop
    controller.stamp = (update) => {
      queued.push(update)
      invalidate()
    }
    return () => {
      controller.cancel = ignoreRaycast
      controller.stamp = update => update()
      dispose()
      active.current = null
      for (const update of queued.splice(0)) update()
    }
  }, [cancel, controller, dispose, invalidate])

  useFrame(() => {
    const element = mesh.current
    if (!element) return
    if (!active.current) {
      const update = queue.current.shift()
      if (update) {
        const card = holder.current?.querySelector<HTMLElement>('.postcard-card')
        if (!card) {
          queueMicrotask(update)
          invalidate()
          return
        }
        const stamp: ActiveStamp = { card, visible: false, began: null }
        active.current = stamp
        start({
          before: stampSnapshot(card, ++sequence.current),
          update,
          after: () => card.isConnected ? stampSnapshot(card, ++sequence.current) : null,
          copy: (frame, side) => {
            const incoming = side === 'after'
            if (!incoming) {
              const ratio = Math.min(gl.getPixelRatio(), 2)
              resources.atlas.setSize(2 * Math.ceil(frame.width * ratio), Math.ceil(frame.height * ratio))
              resources.inset.value = 0.5 / resources.atlas.width
            }
            const width = resources.atlas.width / 2
            resources.atlas.viewport.set(incoming ? width : 0, 0, width, resources.atlas.height)
            resources.copy.render(gl, resources.atlas, frame.texture, !incoming)
            if (!incoming) stamp.visible = true
          },
          ready: () => {
            stamp.began = performance.now()
            invalidate()
          },
          abort: () => {
            active.current = null
            element.visible = false
            invalidate()
          },
        })
      }
    }
    read(gl)
    const stamp = active.current
    const elapsed = stamp?.began == null ? 0 : performance.now() - stamp.began
    if (elapsed >= STAMP_DURATION) active.current = null
    element.visible = !!active.current?.visible
    if (stamp && element.visible) {
      const card = stamp.card.getBoundingClientRect()
      const canvas = gl.domElement.getBoundingClientRect()
      const drawable = stamp.card.isConnected && card.width > 0 && card.height > 0 &&
        canvas.width > 0 && canvas.height > 0
      if (!drawable) {
        element.visible = false
        queueMicrotask(() => {
          if (active.current === stamp) controller.cancel()
        })
        return
      }
      resources.rect.value.set(
        (2 * (card.left - canvas.left) + card.width) / canvas.width - 1,
        1 - (2 * (card.top - canvas.top) + card.height) / canvas.height,
        2 * card.width / canvas.width,
        2 * card.height / canvas.height,
      )
      resources.progress.value = elapsed / STAMP_DURATION
    }
    if (active.current || queue.current.length > 0) invalidate()
  })

  return <>
    {source}
    <mesh
      ref={mesh}
      geometry={resources.geometry}
      material={resources.material}
      frustumCulled={false}
      visible={false}
      renderOrder={100}
      raycast={ignoreRaycast}
      onAfterRender={(renderer, _scene, _camera, _geometry, material) => {
        if (material === resources.material)
          presented(renderer.getRenderTarget(), material.colorWrite)
      }}
    />
  </>
}
