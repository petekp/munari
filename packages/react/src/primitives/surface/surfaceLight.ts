// Surface light — the key light every finish on a canvas is lit by, as a
// handle that moves it without a React render.
//
// The law: a handle holds plain numbers in client CSS px, the coordinates
// of a pointer event, so one handle lights several canvases from the same
// point and each canvas converts it with its own camera when it draws
// (finishRig.tsx). Creating a handle touches no window: it is safe at module
// scope and on the server. A canvas that uses it attaches, and only then
// does a following handle add its one `pointermove` listener.
//
// The cost a move pays, measured on m2 (Chrome for Testing 156, three
// Surfaces, frameloop "demand"): writing the light and drawing at the next
// frame cost 0.9 ms of main-thread time above idle per move; a React state
// update at the page root cost 3.8 ms (docs/materials-api/light-control.md).
//
// Ownership: this module owns the handle's position, the pointer and
// reduced-motion listeners, and which canvases redraw when it moves. The
// rig owns where the position lands in each scene.

/** Where the key stands. Omitted values take the studio defaults below. */
export interface KeyLight {
  /** Client CSS px; omitted: the viewport's horizontal center. */
  x?: number
  /** Client CSS px; omitted: 0.687 of the viewport's height down. */
  y?: number
  /** CSS px above the page. */
  z?: number
  /** Irradiance straight under the light, relative to the studio key, which is 1. */
  brightness?: number
  /** CSS px. Omitted: a point key. Given: a softbox of that size. */
  size?: readonly [number, number]
}

/** A key's resolved position. */
export interface LightPosition {
  /** Null only on the server, when x was omitted. */
  x: number | null
  y: number | null
  z: number
  brightness: number
  size: readonly [number, number] | null
}

export interface SurfaceLight {
  /** Move the key, or its rest position when it follows the pointer. A key given as undefined returns to its default. */
  set(values: KeyLight): void
  get(): LightPosition
  /** Called immediately, then on each set and resize; when following, at most once per frame. */
  subscribe(listener: (position: LightPosition) => void): () => void
}

export type PointerKind = 'mouse' | 'pen' | 'touch'

export interface SurfaceLightOptions extends KeyLight {
  follow?: 'pointer'
  /** Pointers the light follows. Default mouse and pen: a touch drag usually scrolls, and the browser cancels it. */
  pointerTypes?: readonly PointerKind[]
  /** Under prefers-reduced-motion the light rests at its position unless this is `follow`. Default `rest`. */
  reducedMotion?: 'rest' | 'follow'
}

/**
 * How a SurfaceCanvas lights the finishes on it.
 * - `studio`: the studio key and rim, and the studio environments.
 * - `none`: finishes take the scene's own lights and `scene.environment`.
 * - an object: the studio with its key, rim or environment changed.
 */
export type SurfaceLighting =
  | 'studio'
  | 'none'
  | {
      key?: SurfaceLight | KeyLight
      /** `brightness` is relative to the studio rim, which is 1; `elevation` is degrees above the page, default 15. */
      rim?: { brightness?: number; elevation?: number } | false
      /** Relative to the studio environment, which is 1. */
      environmentIntensity?: number
    }

// The looks were tuned with the key this far down the viewport and this
// high over the page: a coat's highlight lands about halfway between the
// key and the camera's axis, so it falls just below the middle
// (docs/materials-api/lighting.md).
export const KEY_REST_Y = 0.687
export const KEY_HEIGHT_PX = 480
const DEFAULT_POINTERS: readonly PointerKind[] = ['mouse', 'pen']

interface LightInternals {
  attach(invalidate: () => void): () => void
}

const internals = new WeakMap<SurfaceLight, LightInternals>()

export function isSurfaceLight(value: SurfaceLight | KeyLight): value is SurfaceLight {
  // SAFETY: WeakMap.has accepts any object and answers false for one it does not hold.
  return internals.has(value as SurfaceLight)
}

/** Redraw with `invalidate` whenever the light moves, until the returned release. */
export function attachSurfaceLight(light: SurfaceLight, invalidate: () => void): () => void {
  const entry = internals.get(light)
  if (!entry) throw new Error('munari: lighting.key is not a light from createSurfaceLight().')
  return entry.attach(invalidate)
}

const hasWindow = () => 'window' in globalThis

function restPosition(rest: KeyLight): LightPosition {
  const browser = hasWindow()
  return {
    x: rest.x ?? (browser ? window.innerWidth / 2 : null),
    y: rest.y ?? (browser ? window.innerHeight * KEY_REST_Y : null),
    z: rest.z ?? KEY_HEIGHT_PX,
    brightness: rest.brightness ?? 1,
    size: rest.size ?? null,
  }
}

/** A key light handle. One handle can light several canvases. */
export function createSurfaceLight(options: SurfaceLightOptions = {}): SurfaceLight {
  const { follow, pointerTypes = DEFAULT_POINTERS, reducedMotion = 'rest', ...start } = options
  const rest: KeyLight = { ...start }
  const canvases = new Set<() => void>()
  const listeners = new Set<(position: LightPosition) => void>()
  let pointer: { x: number; y: number } | null = null
  let reduced = false
  let notifyQueued = 0
  let teardown: (() => void) | null = null

  const following = () => follow === 'pointer' && pointer !== null && (reducedMotion === 'follow' || !reduced)
  const get = (): LightPosition => {
    const position = restPosition(rest)
    if (following() && pointer) return { ...position, x: pointer.x, y: pointer.y }
    return position
  }
  const notify = () => {
    const position = get()
    for (const listener of [...listeners]) listener(position)
  }
  const changed = () => {
    for (const invalidate of canvases) invalidate()
    notify()
  }
  const notifyNextFrame = () => {
    if (notifyQueued) return
    notifyQueued = requestAnimationFrame(() => {
      notifyQueued = 0
      notify()
    })
  }

  const listen = () => {
    const subscriptions = new AbortController()
    const { signal } = subscriptions
    window.addEventListener('resize', changed, { passive: true, signal })
    if (follow === 'pointer') {
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
      reduced = motion.matches
      motion.addEventListener('change', () => {
        reduced = motion.matches
        changed()
      }, { signal })
      window.addEventListener('pointermove', (event) => {
        if (!event.isTrusted) return
        // SAFETY: includes only compares; a pointer type outside the list answers false.
        if (!pointerTypes.includes(event.pointerType as PointerKind)) return
        pointer = { x: event.clientX, y: event.clientY }
        if (reducedMotion === 'rest' && reduced) return
        for (const invalidate of canvases) invalidate()
        notifyNextFrame()
      }, { passive: true, signal })
    }
    return () => {
      subscriptions.abort()
      if (notifyQueued) cancelAnimationFrame(notifyQueued)
      notifyQueued = 0
    }
  }
  const reconcile = () => {
    const active = canvases.size + listeners.size > 0
    if (active && !teardown && hasWindow()) teardown = listen()
    else if (!active && teardown) {
      teardown()
      teardown = null
    }
  }

  const light: SurfaceLight = {
    set(values) {
      Object.assign(rest, values)
      changed()
    },
    get,
    subscribe(listener) {
      listeners.add(listener)
      reconcile()
      listener(get())
      return () => {
        listeners.delete(listener)
        reconcile()
      }
    },
  }
  internals.set(light, {
    attach(invalidate) {
      canvases.add(invalidate)
      reconcile()
      return () => {
        canvases.delete(invalidate)
        reconcile()
      }
    },
  })
  return light
}
