// @vitest-environment happy-dom
// Intent survives fallback; a simultaneous legacy hold cannot be reported as one side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSurfaceStore } from './surfaceHandle'
import { readSurfaceFrameState } from './surfaceFrame'

beforeEach(() => vi.stubGlobal('CanvasRenderingContext2D', class Supported { drawElementImage() {} }))
afterEach(() => vi.unstubAllGlobals())

describe('retained Surface observations', () => {
  it('preserves author intent while the effective request remains on the page', () => {
    const store=createSurfaceStore()
    store.declarePresentation('page')
    store.setAuthorIntent(Symbol(),true,'Unsupported content')
    store.request('page')
    const status=store.getStatus(),frame=readSurfaceFrameState(store.handle)
    expect(status).toEqual({requestedInScene:true,presentation:'page',sceneReady:false,isTransitioning:false,supported:false,reason:'Unsupported content'})
    expect(frame.requestedInScene).toBe(true)
    expect(frame.targetInScene).toBe(false)
    expect(frame.presentation).toBe('page')
  })

  it('keeps snapshots stable and ignores cleanup from an older intent owner', () => {
    const store=createSurfaceStore(),first=Symbol(),second=Symbol()
    store.setAuthorIntent(first,true,null)
    const before=store.getStatus()
    expect(store.getStatus()).toBe(before)
    store.setAuthorIntent(second,false,null)
    store.clearAuthorIntent(first)
    const after=store.getStatus()
    expect(after.requestedInScene).toBe(false)
    expect(after).not.toBe(before)
    store.setAuthorIntent(second,false,null)
    expect(store.getStatus()).toBe(after)
  })

  it('reports absence explicitly and repeatedly rejects a simultaneous legacy hold', () => {
    const store=createSurfaceStore()
    expect(store.getStatus().presentation).toBeNull()
    store.acquire(1)
    store.declarePresentation('page');store.declarePresentation('canvas')
    store.registerPresenter('mesh')
    store.prove('mesh',store.readinessLifetime(),store.epoch())
    store.request('both');store.present('mesh',store.epoch())
    expect(store.getState().presented).toBe('both')
    expect(()=>store.getStatus()).toThrow('one presentation')
    expect(()=>store.getStatus()).toThrow('one presentation')
    expect(()=>readSurfaceFrameState(store.handle)).toThrow('one presentation')
    store.request('none')
    expect(store.getStatus().presentation).toBeNull()
  })
})
