import { createElement, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Surface } from '@petepetrash/munari'

const SurfaceCanvas = lazy(() => import('./deferred/surfaceCanvas.js'))

createRoot(document.getElementById('root')).render(
  createElement(
    'main',
    null,
    createElement(Suspense, { fallback: null }, createElement(SurfaceCanvas, null)),
    createElement(Surface, null, createElement('div', null, 'card')),
  ),
)
