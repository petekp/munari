import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useElementCapture } from '@petepetrash/munari'

function Capture() {
  const capture = useElementCapture()
  return createElement('div', null, String(Boolean(capture)))
}

createRoot(document.getElementById('root')).render(createElement(Capture))
