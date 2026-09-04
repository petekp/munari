import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSurface, surfaceStoreOf } from './surfaceHandle'
import { surfaceManualPresenter } from './surfaceManualPresenter'

// An exclusive Surface with one manual presenter and nothing else: the
// shape a scene compositing its own pixels over a Surface's capture is in.
const airborne = () => {
  const handle = createSurface('panel')
  const store = surfaceStoreOf(handle)
  store.acquire(1)
  store.declarePresentation('page')
  store.declarePresentation('canvas')
  const presenter = surfaceManualPresenter(handle, 'film')
  return { handle, store, presenter }
}

beforeEach(() => {
  class WithTrial { drawElementImage() {} }
  vi.stubGlobal('CanvasRenderingContext2D', WithTrial)
})

afterEach(() => vi.unstubAllGlobals())

describe('the manual presenter seam', () => {
  it('reports a manual mesh that has no advanced presenter', () => {
    const handle = createSurface('panel')
    const store = surfaceStoreOf(handle)
    const errors: Error[] = []
    store.setCallbacks({ onError: (error) => errors.push(error) })
    const release = store.expectManualPresenter('default')
    store.validatePresentation()
    expect(errors.some((error) => error.message.includes('surfaceManualPresenter'))).toBe(true)
    release()
  })

  it('accepts an advanced presenter covering the manual mesh part', () => {
    const { store, presenter } = airborne()
    const releaseExpectation = store.expectManualPresenter('default')
    const releasePresenter = presenter.register()
    const errors: Error[] = []
    store.setCallbacks({ onError: (error) => errors.push(error) })
    store.validatePresentation()
    expect(errors).toEqual([])
    releasePresenter()
    releaseExpectation()
  })

  it('holds the page until the registered presenter presents', () => {
    const { store, presenter } = airborne()
    const leave = presenter.register()
    store.request('canvas')
    presenter.prove()
    store.tick(500)
    expect(presenter.canvasPresents()).toBe(true)
    expect(presenter.holdsPage()).toBe(true)
    presenter.present()
    expect(presenter.holdsPage()).toBe(false)
    expect(store.getState().presented).toBe('canvas')
    leave()
  })

  it('a presenter that never presents never releases the page', () => {
    const { store, presenter } = airborne()
    presenter.register()
    store.request('canvas')
    presenter.prove()
    store.tick(500)
    store.tick(500)
    expect(presenter.holdsPage()).toBe(true)
  })

  it('leaving the ledger takes stage two with it', () => {
    const { store, presenter } = airborne()
    const leave = presenter.register()
    store.request('canvas')
    presenter.prove()
    store.tick(500)
    presenter.present()
    expect(presenter.holdsPage()).toBe(false)
    leave()

    // Home, then out a second time. The departed entry must not stand in
    // for the new registration's own draw, or the page lets go of the
    // second crossing before anything has been drawn for it.
    store.request('page')
    store.tick(2_000)
    expect(presenter.holdsPage()).toBe(true)
    presenter.register()
    store.request('canvas')
    presenter.prove()
    store.tick(500)
    expect(presenter.holdsPage()).toBe(true)
    presenter.present()
    expect(presenter.holdsPage()).toBe(false)
  })

  // The stamps are read at the moment of the report, so a receipt earned
  // under a controller that has since gone is refused rather than believed.
  it('refuses a report from a released identity', () => {
    const { store, presenter } = airborne()
    presenter.register()
    store.request('canvas')
    store.release(1)
    presenter.prove()
    expect(store.getState().ready).toBe(false)
  })

  it('exposes only the presenter verbs', () => {
    const { presenter } = airborne()
    expect(Object.keys(presenter).sort()).toEqual([
      'canvasPresents',
      'hearsPointer',
      'holdsPage',
      'present',
      'prove',
      'register',
    ])
  })
})
