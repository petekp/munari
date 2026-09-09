// @vitest-environment happy-dom
// Frame reads must see the controller immediately; pose listeners own no perpetual work.
import { describe, expect, it, vi } from 'vitest'
import { createSurfaceFrameChannel, readSurfaceFrameState, surfaceBelongsToScene } from './surfaceFrame'
import { createSurfaceStore } from './surfaceHandle'
import { surfaceHost } from './surfaceHostRegistry'
import { Camera, Scene, Mesh, Group, WebGLRenderTarget } from 'three'

describe('frame state', () => {
  it('reads a new request without waiting for a React render', () => {
    const store = createSurfaceStore('frame-state')
    store.acquire(1)
    store.declarePresentation('page')
    store.declarePresentation('canvas')
    expect(readSurfaceFrameState(store.handle).requestedInScene).toBe(false)
    store.request('canvas')
    expect(readSurfaceFrameState(store.handle).requestedInScene).toBe(true)
    expect(readSurfaceFrameState(store.handle).presentation).toBe('page')
    expect(readSurfaceFrameState(store.handle).canvasMayDraw).toBe(false)
    store.release(1)
  })

  it('withdraws the frame duty when its last listener leaves', () => {
    const channel = createSurfaceFrameChannel()
    const changed = vi.fn()
    const stop = channel.subscribePresence(changed)
    const a = channel.subscribe(() => {})
    const b = channel.subscribe(() => {})
    expect(channel.hasListeners()).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    a()
    expect(changed).toHaveBeenCalledTimes(1)
    b()
    expect(channel.hasListeners()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not skip another companion when a callback unregisters itself', () => {
    const host = surfaceHost('companion-order')
    const seen: string[] = []
    let release = () => {}
    release = host.registerBeforeDraw(() => { seen.push('first'); release() })
    const second = host.registerBeforeDraw(() => seen.push('second'))
    expect(host.hasBeforeDraw()).toBe(true)
    host.beforeDraw(new Scene(), new Camera())
    expect(seen).toEqual(['first', 'second'])
    second()
    expect(host.hasBeforeDraw()).toBe(false)
  })
})

it('reports the actual draw camera and target and follows live scene membership',()=>{
 const host=surfaceHost('passes'),scene=new Scene(),other=new Scene(),group=new Group(),mesh=new Mesh()
 scene.add(group);group.add(mesh)
 expect(surfaceBelongsToScene(mesh,scene)).toBe(true)
 expect(surfaceBelongsToScene(mesh,other)).toBe(false)
 const first=new Camera(),second=new Camera(),target=new WebGLRenderTarget(4,4)
 const seen: {camera:Camera;target:WebGLRenderTarget|null}[]=[]
 const stop=host.registerBeforeDraw((_scene,camera,target)=>seen.push({camera,target}))
 host.beforeDraw(scene,first);host.beforeDraw(scene,second,target)
 expect(seen).toEqual([{camera:first,target:null},{camera:second,target}])
 other.add(group)
 expect(surfaceBelongsToScene(mesh,scene)).toBe(false)
 expect(surfaceBelongsToScene(mesh,other)).toBe(true)
 stop();target.dispose()
})
