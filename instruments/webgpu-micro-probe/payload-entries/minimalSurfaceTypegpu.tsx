import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MicroCanvas, MicroSurface } from '../engine/reactHost'
import { createDefaultUnlitTypeGpuMaterial } from '../engine/typegpuMaterial'

const unlitFactory = { create: createDefaultUnlitTypeGpuMaterial }

createRoot(document.getElementById('root')!).render(
  createElement(
    'main',
    null,
    createElement(MicroCanvas, null),
    createElement(MicroSurface, { materialFactory: unlitFactory }, createElement('div', null, 'card')),
  ),
)
