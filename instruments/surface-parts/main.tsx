// Duplicate-part recovery — public declarations, retained inputs, actual pixels.
// The invalid declaration remains diagnosed. Removing either duplicate must
// recover the surviving content without remounting it or resizing its source.
import { Fragment, StrictMode, useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useThree } from '@react-three/fiber'
import { SceneSurface, Surface, SurfaceCanvas, useSurfaceHandle, useSurfaceStatus, type SurfaceHandle } from '@petepetrash/munari'
import '@petepetrash/munari/style.css'

type Owner = 'first' | 'last'
interface DrawRead { pixel: number[] | null; error: number | null; dpr: number | null }
interface PartInputs { first: HTMLInputElement | null; last: HTMLInputElement | null }
const parameters = new URLSearchParams(location.search)
const wiring = parameters.get('wiring') === 'page' ? 'page' : 'scene'
const strict = parameters.get('strict') === '1'
const diagnostics: string[] = []
const inputs: PartInputs = { first: null, last: null }
const mounts = { first: 0, last: 0 }
const unmounts = { first: 0, last: 0 }
let presentation: ReturnType<typeof useSurfaceStatus>['presentation'] = null
let readDraw: () => DrawRead = () => ({ pixel: null, error: null, dpr: null })
let removePart: (owner: Owner) => void = () => {}
let remembered: { owner: Owner; input: HTMLInputElement; mounts: number; unmounts: number } | null = null

function Content({ owner }: { owner: Owner }) {
  const bindInput = useCallback((input: HTMLInputElement | null) => { inputs[owner] = input }, [owner])
  useEffect(() => {
    mounts[owner]++
    return () => { unmounts[owner]++ }
  }, [owner])
  return <div data-owner={owner} style={{ width: 200, height: 120, position: 'relative', background: owner === 'first' ? 'rgb(255,0,0)' : 'rgb(0,255,0)' }}>
    <span style={{ position: 'absolute', top: 4, left: 8 }}>{owner}</span>
    <input ref={bindInput} aria-label={`${owner} retained input`} defaultValue={`${owner} initial`} style={{ position: 'absolute', bottom: 8, left: 8, width: 170 }}/>
  </div>
}

function Status({ surface }: { surface: SurfaceHandle }) {
  presentation = useSurfaceStatus(surface).presentation
  return null
}

function Observe() {
  const state = useThree()
  useEffect(() => {
    readDraw = () => {
      state.gl.render(state.scene, state.camera)
      const gl = state.gl.getContext()
      const pixel = new Uint8Array(4)
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      return { pixel: [...pixel], error: gl.getError(), dpr: state.gl.getPixelRatio() }
    }
    return () => { readDraw = () => ({ pixel: null, error: null, dpr: null }) }
  }, [state])
  return null
}

function Fixture() {
  const surface = useSurfaceHandle('duplicate-parts')
  const [owners, setOwners] = useState<readonly Owner[]>(['first', 'last'])
  const remove = useCallback((owner: Owner) => flushSync(() => setOwners(current => current.filter(value => value !== owner))), [])
  removePart = remove
  const onError = useCallback((error: Error) => { diagnostics.push(error.message) }, [])
  const mesh = <Surface.Mesh part="panel" placement="manual" pointerEvents="none" geometry={<planeGeometry args={[200,120]}/>}/>
  return <>
    <header style={{ padding: 24 }}>
      <h1>Duplicate-part recovery</h1>
      <p>{wiring} wiring; Strict Mode {strict ? 'on' : 'off'}. The scene starts green. Removing the last part should reveal red.</p>
      <button id="remove-first" onClick={() => remove('first')} disabled={!owners.includes('first')}>Remove first</button>{' '}
      <button id="remove-last" onClick={() => remove('last')} disabled={!owners.includes('last')}>Remove last</button>
    </header>
    <Status surface={surface}/>
    <SurfaceCanvas id="parts" orthographic flat camera={{ position:[0,0,1000], zoom:1 }} frameloop="always" style={{ position:'fixed', left:320, top:180, width:480, height:320 }}>
      <Observe/>
      {wiring === 'scene' && <SceneSurface.Root surface={surface} onError={onError}>
        {owners.map(owner => <SceneSurface.HTML key={owner} part="panel" size={[200,120]} resolution={1}><Content owner={owner}/></SceneSurface.HTML>)}
        {mesh}
      </SceneSurface.Root>}
    </SurfaceCanvas>
    {wiring === 'page' && <div style={{ position:'absolute', left:24, top:180, width:220 }}>
      <Surface.Root surface={surface} canvasId="parts" inScene timing={{ settleMs:0, durationMs:1 }} onError={onError}>
        {owners.map(owner => <Surface.HTML key={owner} part="panel" size={[200,120]} resolution={1}><Content owner={owner}/></Surface.HTML>)}
        {mesh}
      </Surface.Root>
    </div>}
  </>
}

const proof = {
  remember(owner: Owner) {
    const input = inputs[owner]
    if (!input) throw new Error(`Missing ${owner} input before removal`)
    remembered = { owner, input, mounts: mounts[owner], unmounts: unmounts[owner] }
    input.value = `${owner} edited before removal`
    input.dispatchEvent(new Event('input', { bubbles:true }))
  },
  remove(owner: Owner) { removePart(owner) },
  read() {
    return {
      wiring, strict, presentation, diagnostics: [...diagnostics], ...readDraw(),
      inputs: { first: inputs.first?.value ?? null, last: inputs.last?.value ?? null },
      retained: remembered ? {
        owner: remembered.owner,
        sameInput: inputs[remembered.owner] === remembered.input,
        connected: remembered.input.isConnected,
        value: remembered.input.value,
        mountsBefore: remembered.mounts, mountsAfter: mounts[remembered.owner],
        unmountsBefore: remembered.unmounts, unmountsAfter: unmounts[remembered.owner],
      } : null,
    }
  },
}
declare global { interface Window { __partsProof: typeof proof } }
window.__partsProof = proof
createRoot(document.getElementById('root')!).render(strict ? <StrictMode><Fixture/></StrictMode> : <Fragment><Fixture/></Fragment>)
