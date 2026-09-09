// A layout target changes parents without replacing a focused input or its React state.
import { useEffect, useState } from 'react'
import { Surface, usePageTarget } from '@petepetrash/munari'

const record = { mounts: 0, unmounts: 0 }
function Content() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    record.mounts++
    return () => { record.unmounts++ }
  }, [])
  return <div style={{width:250,height:90,background:'white',padding:10}}>
    <input id="target-input" aria-label="Retained note" defaultValue="Original" />
    <button id="target-count" onClick={() => setCount(value => value + 1)}>Count {count}</button>
  </div>
}
function RetainedContent() {
  const target = usePageTarget()
  const [right, setRight] = useState(false)
  const [attached, setAttached] = useState(true)
  return <>
    <button id="target-move" onMouseDown={event => event.preventDefault()} onClick={() => setRight(value => !value)}>Move slot</button>
    <button id="target-attach" onClick={() => setAttached(value => !value)}>Toggle slot</button>
    <div style={{display:'flex',gap:20}}>
      <section id="target-left">{attached && !right && <div ref={target.ref} />}</section>
      <section id="target-right">{attached && right && <div ref={target.ref} />}</section>
    </div>
    <Surface.Root inScene={false}>
      <Surface.HTML target={target}><Content /></Surface.HTML>
    </Surface.Root>
  </>
}
export function PageTargets() {
  const [mounted, setMounted] = useState(true)
  return <section>
    <h2>Retained content in changing layout slots</h2>
    <button id="target-unmount" onClick={() => setMounted(false)}>Unmount example</button>
    {mounted && <RetainedContent />}
  </section>
}
Object.assign(window, { __pageTargets: record })
