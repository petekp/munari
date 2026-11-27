// Finish demo bar — the page title and whether the cards are drawn on Surfaces.

import { Status } from '../../components/system'
import { sceneUrl } from '../../captureMode'

export function DemoBar({ inScene }: { readonly inScene: boolean }) {
  return (
    <header className="fd-bar">
      <a href={sceneUrl('home')} className="mf-wordmark">
        munari <span className="mf-wordmark-note">· finishes in use</span>
      </a>
      <Status status={inScene ? 'live' : 'fallback'}>{inScene ? 'Finishes on Surfaces' : 'Page HTML'}</Status>
    </header>
  )
}

/** Where the code on this page comes from. */
export const CODE_NOTE = 'The finishes are the presets in registry/finishes: copy that file and edit any value. RecaptureOnStyle is the material finishes scene’s.'
