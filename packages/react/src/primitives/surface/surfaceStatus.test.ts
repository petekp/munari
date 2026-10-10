// @vitest-environment happy-dom
// Intent survives fallback, and a Surface nothing presents reports no presentation.
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
    expect(status).toEqual({requestedInScene:true,presentation:'page',sceneReady:false,isTransitioning:false,supported:false,reason:'Unsupported content',engine:'html-in-canvas'})
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

  it('names the remedies and reports no engine when none can run here', () => {
    vi.unstubAllGlobals()
    const store=createSurfaceStore()
    store.setAuthorIntent(Symbol(),true,null)
    const status=store.getStatus()
    expect(status.supported).toBe(false)
    expect(status.engine).toBeNull()
    expect(status.reason).toContain('CanvasDrawElement')
    expect(status.reason).toContain('enableSnapdomCapture()')
  })

  it('reports absence explicitly', () => {
    const store=createSurfaceStore()
    expect(store.getStatus().presentation).toBeNull()
  })
})
