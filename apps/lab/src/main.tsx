import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { supportsCapture } from '@petepetrash/munari/gpu'
// The library's own stylesheet first — it is all mechanism, and shadcn.css
// below is this app's answer to what it asks for.
import '@petepetrash/munari/style.css'
import './shadcn.css'
import './components/system/tokens.css'
import './app.css'
import App from './App'
import { CAPTURE_MODE } from './captureMode'

// Installed BEFORE the first render, and awaited: a Surface keeps the engine
// active when its source is built. In default `auto` mode, `@zumer/snapdom` is
// dynamically imported only when native HTML-in-canvas is absent, so Chrome
// 157+ pays zero bundle cost while every unflagged browser, webview, Safari,
// and Firefox session falls back to snapDOM automatically regardless of URL.
if (CAPTURE_MODE === 'snapdom' || (CAPTURE_MODE === 'auto' && !supportsCapture())) {
  const { enableSnapdomCapture } = await import('@petepetrash/munari/snapdom')
  enableSnapdomCapture({
    always: CAPTURE_MODE === 'snapdom',
    isolatedTextInputs: '[data-munari-capture-region]',
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
