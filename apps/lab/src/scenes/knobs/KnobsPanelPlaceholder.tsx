// Panel placeholder — the Knobs panel's face in the page until its
// SceneSurface is shown.
//
// The law: a SceneSurface has no page presentation, so on a cold load the
// panel was absent until 1.66 s (docs/loading/decisions.md D2). The
// placeholder stands at the box the scene opens the panel at, with the
// captured root's own look.
//
// Ownership: <Loading> reports when the panel is shown; Knobs places the
// panel in the scene.

import { useLoadingStatus } from '@petepetrash/munari'
import { PANEL_RADIUS } from './knobsGeometry'
import { PANEL_EDGE_INSET } from './knobsResize'

export function KnobsPanelPlaceholder({ width }: { readonly width: number }) {
  const loading = useLoadingStatus()
  const panelShown =
    loading.status === 'loaded' ||
    loading.entries.some((entry) => entry.kind === 'scene-surface' && entry.label === 'knobs-panel' && entry.status === 'shown')
  if (panelShown) return null
  return (
    <div
      className="knb-panel"
      aria-hidden
      style={{
        position: 'fixed',
        top: '50%',
        right: PANEL_EDGE_INSET,
        zIndex: 0,
        width,
        height: `max(430px, calc(100vh - ${PANEL_EDGE_INSET * 2}px))`,
        borderRadius: PANEL_RADIUS,
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
      }}
    />
  )
}
