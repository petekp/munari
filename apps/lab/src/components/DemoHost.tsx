// Demo host — a bounded viewport with a separate layer for local overlays.
// The scroller and its overlays share theme values without sharing scroll motion.
// The inset Home checks pin their agreement after a (104, 72)px move (#59).
import { createContext, use, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface DemoEnvironment {
  viewport: RefObject<HTMLDivElement | null>
  overlay: HTMLDivElement
}

const DemoContext = createContext<DemoEnvironment | null>(null)

export function DemoHost({ children, className = '' }: { children: ReactNode; className?: string }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null)
  const environment = useMemo(() => overlay ? { viewport, overlay } : null, [overlay])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => {
      element.style.setProperty('--demo-width', `${element.clientWidth}px`)
      element.style.setProperty('--demo-height', `${element.clientHeight}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={viewport} data-demo-host className={`@container/demo relative isolate h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden ${className}`}>
      <div ref={setOverlay} data-demo-overlay className="pointer-events-none absolute inset-0 z-30" />
      {environment && <DemoContext value={environment}>{children}</DemoContext>}
    </div>
  )
}

export function useDemoViewport() {
  const environment = use(DemoContext)
  if (!environment) throw new Error('useDemoViewport requires a DemoHost.')
  return environment.viewport
}

export function DemoOverlay({ children }: { children: ReactNode }) {
  const environment = use(DemoContext)
  if (!environment) throw new Error('DemoOverlay requires a DemoHost.')
  return createPortal(children, environment.overlay)
}
