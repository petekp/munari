import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MicroCanvas, MicroSurface } from '../engine/reactHost'

createRoot(document.getElementById('root')!).render(
  createElement(
    'main',
    null,
    createElement(MicroCanvas, null),
    createElement(MicroSurface, null, createElement('div', null, 'card')),
  ),
)
