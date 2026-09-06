// Motion preference — a reactive browser setting for the overview's demo.
// The server snapshot stays still; changes apply without reloading the page.
import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'
const read = () => window.matchMedia(QUERY).matches
const server = () => true
function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
export function useHomeReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, server)
}
