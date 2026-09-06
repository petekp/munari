// One shader draws both sources; the input proxy is not presentation evidence.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShaderMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import {
  Surface, useSurfaceHandle, useSurfaceStatus,
  useSurfaceTexture, useSurfaceTextureOf, type SurfaceHandle,
} from '@petepetrash/munari'

function SplitMaterial({ surface }: { surface: SurfaceHandle }) {
  const first = useSurfaceTexture()
  const second = useSurfaceTextureOf(surface, 'second')
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ first: { value: first }, second: { value: second } }), [first, second])
  useFrame(() => { const a = material.current?.uniforms.first, b = material.current?.uniforms.second; if (a && b) { a.value = first; b.value = second } })
  return <shaderMaterial ref={material} uniforms={uniforms} toneMapped={false}
    vertexShader="varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
    fragmentShader={`uniform sampler2D first; uniform sampler2D second; varying vec2 vUv;
void main(){gl_FragColor=vUv.x<0.5?texture2D(first,vUv):texture2D(second,vUv);
#include <colorspace_fragment>
}`} />
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
    <Surface.Root surface={surface} canvas="composed" inScene={requested} timing={{ settleMs: 0, durationMs: 1 }}>
      <Surface.HTML part="first"><div id="sampled-page" style={{ width: 300, height: 180, background: '#ff0000' }}>First source</div></Surface.HTML>
      {second && <Surface.HTML part="second" hidden size={[300, 180]}><div style={{ width: 300, height: 180, background: '#0000ff' }}>Second source</div></Surface.HTML>}
      <Surface.Scene>
        <Surface.Mesh part="first" sampledParts={['second']} material={<SplitMaterial surface={surface} />} />
        <Surface.Mesh part="second" presentation="manual" pointerEvents="none" material={<meshBasicMaterial colorWrite={false} depthWrite={false} />} />
      </Surface.Scene>
    </Surface.Root>
  </section>
}
