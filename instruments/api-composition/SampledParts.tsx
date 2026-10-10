// One shader draws both sources; the input proxy is not presentation evidence.
import { useEffect, useMemo, useState } from 'react'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { texture, uv, vec4 } from 'three/tsl'
import {
  Surface, premultipliedOutput, useSurfaceHandle, useSurfaceNodes, useSurfaceStatus,
  useSurfaceTextureOf, type SurfaceHandle,
} from '@petepetrash/munari'

function SplitMaterial({ surface }: { surface: SurfaceHandle }) {
  const first = useSurfaceNodes()
  const second = useSurfaceTextureOf(surface, 'second')
  // Rebuilt when the second source arrives: a texture node compiles its
  // texture's color-space decode into the shader, so it cannot start empty.
  const material = useMemo(() => {
    const created = new MeshBasicNodeMaterial()
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const left = first.map.sample(uv()) as Node<'vec4'>
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const right = second ? texture(second).sample(uv()) as Node<'vec4'> : vec4(0, 0, 0, 0)
    created.outputNode = premultipliedOutput(uv().x.lessThan(0.5).select(left, right))
    return created
  }, [first, second])
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={material} attach="material" />
}

export function SampledParts() {
  const surface = useSurfaceHandle('sampled-parts')
  const [requested, setRequested] = useState(false)
  const [second, setSecond] = useState(false)
  const state = useSurfaceStatus(surface)
  useEffect(() => { Object.assign(window, { __sampledParts: state }) }, [state])
  return <section>
    <h2>One mesh draws two sources</h2>
    <button id="sampled-toggle" onClick={() => setRequested(value => !value)}>Toggle composite</button>
    <button id="sampled-source" onClick={() => setSecond(true)}>Attach second source</button>
    <Surface.Root surface={surface} canvasId="composed" inScene={requested}>
      <Surface.HTML part="first"><div id="sampled-page" style={{ width: 300, height: 180, background: '#ff0000' }}>First source</div></Surface.HTML>
      {second && <Surface.HTML part="second" hidden size={[300, 180]}><div style={{ width: 300, height: 180, background: '#0000ff' }}>Second source</div></Surface.HTML>}
      <Surface.Scene>
        <Surface.Mesh part="first" sampledParts={['second']} material={<SplitMaterial surface={surface} />} />
        <Surface.Mesh part="second" presentation="manual" pointerEvents="none" material={<meshBasicMaterial colorWrite={false} depthWrite={false} />} />
      </Surface.Scene>
    </Surface.Root>
  </section>
}
