import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(
  createElement('main', null, createElement('div', null, 'card')),
)
