import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The library's own stylesheet first — it is all mechanism, and shadcn.css
// below is this app's answer to what it asks for.
import '@petepetrash/munari/style.css'
import './shadcn.css'
import './app.css'
import App from './App'
import { CAPTURE_MODE } from './captureMode'

// The engine is installed BEFORE the first render, and awaited: a Surface
// that has already built its source keeps the engine it was made with, so an
// install that lands one microtask late reaches nothing. Dynamically imported
// so `@zumer/snapdom` stays out of the bundle every ordinary visit loads.
if (CAPTURE_MODE) {
  const { enableSnapdomCapture } = await import('@petepetrash/munari/snapdom')
  enableSnapdomCapture({ always: CAPTURE_MODE === 'snapdom' })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
