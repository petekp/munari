// Surface validation — diagnose omissions after the owning renderer is ready.
// A missing host is a wait, not a missing declaration. Decision #40 assigns
// ten-second development warnings to waits without forcing a handoff.
// The root owns this subscription; the host owns the frame that validates it.
import type { SurfaceStore } from './surfaceHandle'
import type { SurfaceHost } from './surfaceHostRegistry'

const WAIT_WARNING_MS = 10_000 // Diagnostic deadline, decision #40; never a readiness budget.

// SAFETY: Vite supplies env; an unbundled module has no development flag.
const DEVELOPMENT = (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }).env?.DEV === true

export function watchSurfaceValidation(store: SurfaceStore, host: SurfaceHost | null, development = DEVELOPMENT): () => void {
  let live = true
  let queued = false
  let validatedRuntime: object | null = null
  let releaseTick: (() => void) | null = null
  let waiting: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const updateWarning = () => {
    const state = store.getState()
    const seeksScene = state.supported && (state.requested === 'canvas' || state.requested === 'both')
    const next = !seeksScene ? null : !host?.mounted() ? 'a mounted SurfaceCanvas' : !host.available() ? 'an available renderer' : store.preparationWait()
    if (next === waiting) return
    waiting = next
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (development && next) timer = setTimeout(() => {
      timer = null
      console.warn(`[munari] Surface${store.name ? ` "${store.name}"` : ''} is still waiting for ${next} after 10 seconds. Its current presentation remains usable.`)
    }, WAIT_WARNING_MS)
  }
  const sync = () => {
    updateWarning()
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!live) return
      store.validatePresentation(false)
      if (!host?.available()) {
        validatedRuntime = null
        releaseTick?.(); releaseTick = null
        return
      }
      if (validatedRuntime === host.runtime) { store.validatePresentation(); return }
      if (releaseTick) return
      releaseTick = host.registerTick(() => {
        releaseTick?.(); releaseTick = null
        validatedRuntime = host.runtime
        store.validatePresentation()
        updateWarning()
      })
      host.invalidate()
    })
  }
  const releaseWork = store.subscribeWork(sync)
  const releaseHost = host?.subscribeRuntime(sync)
  sync()
  return () => {
    live = false
    releaseWork(); releaseHost?.(); releaseTick?.()
    if (timer !== null) clearTimeout(timer)
  }
}
