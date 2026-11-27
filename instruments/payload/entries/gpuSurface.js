import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Surface, SurfaceCanvas } from '@petepetrash/munari/gpu'

createRoot(document.getElementById('root')).render(
  createElement(
    'main',
    null,
    createElement(SurfaceCanvas, null),
    createElement(Surface, null, createElement('div', null, 'card')),
  ),
)
