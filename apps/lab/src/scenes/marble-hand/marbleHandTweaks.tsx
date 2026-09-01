// Marble-hand controls — the marble-hand scene's schema for the shared
// tweak panel.
//
// The law: controls remain native above the scene. The hand must remain
// visible and still while a slider changes its pose or material. The
// 2026-08-30 pointer study fixed the tip to the mouse; carrying that
// behavior into an overlay would put the sculpture underneath its controls.
//
// Ownership: the scene owns one live settings object and preview state.
// This file owns turning MARBLE_HAND_GROUPS into the shared panel's schema
// and the bespoke content (material switch, presets, background controls)
// no tuning field covers; the panel itself lives in components/tweakPanel.tsx.

import type { MarblePageCaptureState } from './marbleHandPageCapture'
import type { MarbleHandThemeId } from './marbleHandThemes'
import {
  MARBLE_HAND_GROUPS,
  MARBLE_HAND_ORIENTATIONS,
  marbleHandTuning,
  normalizeMarbleHandInput,
  normalizeMarbleHandTuning,
  type MarbleHandControl,
  type MarbleHandControlGroup,
  type MarbleHandTuning,
} from './marbleHandTuning'
import { TweakColorField, TweakPanel, TweakToggleField, type TweakControl, type TweakGroup } from '../../components/tweakPanel'
import './marbleHandTweaks.css'

interface MarbleHandTweaksProps {
  readonly tuning: MarbleHandTuning
  readonly theme: MarbleHandThemeId
  readonly onChange: (next: MarbleHandTuning) => void
  readonly ready: boolean
  readonly unavailable: boolean
  readonly parked: boolean
  readonly onParked: (next: boolean) => void
  readonly previewPressed: boolean
  readonly onPreviewPressed: (next: boolean) => void
  readonly colorMotion: boolean
  readonly reducedMotion: boolean
  readonly onToggleColorMotion: () => void
  readonly reflection: MarblePageCaptureState['status']
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function toTweakControl(control: MarbleHandControl, tuning: MarbleHandTuning, onChange: (next: MarbleHandTuning) => void): TweakControl {
  const factor = control.degrees ? 180 / Math.PI : 1
  return {
    id: control.key,
    label: control.label,
    min: control.min,
    max: control.max,
    step: control.step,
    unit: control.degrees ? '°' : control.unit,
    value: tuning[control.key] * factor,
    onChange: (next) => {
      const normalized = normalizeMarbleHandInput(control, next)
      if (normalized !== null) onChange({ ...tuning, [control.key]: normalized })
    },
    numberAttrs: { 'data-tuning-key': control.key },
    rangeAttrs: { 'data-tuning-key': control.key },
  }
}

function groupExtra(
  group: MarbleHandControlGroup,
  tuning: MarbleHandTuning,
  onChange: (next: MarbleHandTuning) => void,
  onParked: (next: boolean) => void,
) {
  switch (group.title) {
    case 'Orientation':
      return (
        <div className="mh-pose-presets" aria-label="Orientation presets">
          {MARBLE_HAND_ORIENTATIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-hand-preset={preset.id}
              aria-pressed={
                Math.abs(tuning.baseRotation - preset.baseRotation) < 0.00001 &&
                Math.abs(tuning.sculptureRoll - preset.sculptureRoll) < 0.00001 &&
                Math.abs(tuning.sculpturePitch - preset.sculpturePitch) < 0.00001
              }
              onClick={() => {
                onChange({ ...tuning, baseRotation: preset.baseRotation, sculptureRoll: preset.sculptureRoll, sculpturePitch: preset.sculpturePitch })
                onParked(true)
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )
    case 'Size & height':
      return <TweakToggleField label="Keep above page" checked={tuning.keepAbovePage} onChange={(keepAbovePage) => onChange({ ...tuning, keepAbovePage })} />
    case 'Movement':
      return <TweakToggleField label="Motion rocking" checked={tuning.motionEnabled} onChange={(motionEnabled) => onChange({ ...tuning, motionEnabled })} />
    case 'Idle tap':
      return <TweakToggleField label="Idle tapping" checked={tuning.tapEnabled} onChange={(tapEnabled) => onChange({ ...tuning, tapEnabled })} />
    case 'Marble':
      return (
        <div className="mh-tweak-colors">
          <TweakColorField id="stoneColor" label="Stone color" value={tuning.stoneColor} onChange={(stoneColor) => onChange({ ...tuning, stoneColor })} />
          <TweakColorField id="veinColor" label="Vein color" value={tuning.veinColor} onChange={(veinColor) => onChange({ ...tuning, veinColor })} />
        </div>
      )
    case 'Chrome':
      return <TweakColorField id="chromeTint" label="Chrome tint" value={tuning.chromeTint} onChange={(chromeTint) => onChange({ ...tuning, chromeTint })} />
    case 'Stroke':
      return (
        <>
          <TweakToggleField label="Show stroke" checked={tuning.strokeEnabled} onChange={(strokeEnabled) => onChange({ ...tuning, strokeEnabled })} />
          <TweakColorField id="strokeColor" label="Stroke color" value={tuning.strokeColor} onChange={(strokeColor) => onChange({ ...tuning, strokeColor })} />
        </>
      )
    case 'Lighting':
      return <TweakColorField id="lightColor" label="Light color" value={tuning.lightColor} onChange={(lightColor) => onChange({ ...tuning, lightColor })} />
    case 'Shadows':
      return (
        <>
          <TweakToggleField label="Cast shadows" checked={tuning.shadowsEnabled} onChange={(shadowsEnabled) => onChange({ ...tuning, shadowsEnabled })} />
          <label className="tweak-select">
            <span>Shadow resolution</span>
            <select value={tuning.shadowMapSize} onChange={(event) => onChange({ ...tuning, shadowMapSize: Number(event.target.value) })}>
              <option value={512}>512 · fast</option>
              <option value={1024}>1024</option>
              <option value={2048}>2048 · balanced</option>
              <option value={4096}>4096 · fine</option>
            </select>
          </label>
        </>
      )
    default:
      return null
  }
}

export function MarbleHandTweaks({
  tuning,
  theme,
  onChange,
  ready,
  unavailable,
  parked,
  onParked,
  previewPressed,
  onPreviewPressed,
  colorMotion,
  reducedMotion,
  onToggleColorMotion,
  reflection,
}: MarbleHandTweaksProps) {
  const groups: readonly TweakGroup[] = MARBLE_HAND_GROUPS
    .filter((group) => !(group.material && group.material !== tuning.materialMode))
    .filter((group) => !(group.theme && group.theme !== theme))
    .map((group) => ({
      key: slugify(group.title),
      title: group.title,
      description: group.description,
      initiallyOpen: group.initiallyOpen,
      extra: groupExtra(group, tuning, onChange, onParked),
      controls: group.controls.map((control) => toTweakControl(control, tuning, onChange)),
    }))

  return (
    <TweakPanel
      title="Hand controls"
      eyebrow="Sculpture study"
      idPrefix="marble-hand"
      groups={groups}
      tuning={tuning}
      onReset={() => { onChange({ ...marbleHandTuning }); onPreviewPressed(false) }}
      storageKey="munari-lab-marble-hand-tuning"
      normalizeTuning={normalizeMarbleHandTuning}
      onApplyStored={onChange}
      initiallyOpen
      className="mh-tweak-panel"
      position="bottom-right"
      openerLabel={<>Tweak hand <span aria-hidden="true">↗</span></>}
      rootAttrs={{ 'data-marble-hand-controls': '' }}
      closeAriaLabel="Close hand controls"
      resetDisabled={!ready}
      fieldsetDisabled={!ready}
      footerHint="Changes are live. Reset restores the original study."
      onOpenChange={(open) => {
        if (open) onParked(true)
        else { onParked(false); onPreviewPressed(false) }
      }}
      beforeFieldset={
        <>
          {!ready ? (
            <p className="mh-controls-notice" role="status">
              {unavailable
                ? 'The 3D preview is unavailable. Reload to try again. The native page still works.'
                : 'The hand is loading. The native page and browser pointer are ready.'}
            </p>
          ) : null}
          <section className="mh-background-controls" aria-label="Background controls">
            <div className="mh-background-controls-heading">
              <h3>Background</h3>
              <button
                className="mh-background-motion"
                type="button"
                data-marble-motion-toggle
                disabled={reducedMotion}
                onClick={onToggleColorMotion}
              >
                <span aria-hidden="true">{colorMotion ? 'Ⅱ' : '▶'}</span>
                {reducedMotion ? 'Motion off' : colorMotion ? 'Pause color' : 'Play color'}
              </button>
            </div>
            {reflection === 'unsupported' || reflection === 'error' ? (
              <p className="mh-controls-notice" data-marble-reflection-notice role="status">
                {reflection === 'unsupported'
                  ? 'Full-page reflections need Chrome with HTML-in-canvas enabled. The native page still works here.'
                  : 'Page capture is unavailable. Reload to restore full-page reflections.'}
              </p>
            ) : null}
          </section>
        </>
      }
    >
      <div className="mh-material-mode" role="group" aria-label="Hand material">
        <button
          type="button"
          data-hand-material="marble"
          aria-pressed={tuning.materialMode === 'marble'}
          onClick={() => onChange({ ...tuning, materialMode: 'marble' })}
        >
          <span className="mh-finish-swatch mh-finish-marble" aria-hidden="true" /> Marble
        </button>
        <button
          type="button"
          data-hand-material="chrome"
          aria-pressed={tuning.materialMode === 'chrome'}
          onClick={() => onChange({ ...tuning, materialMode: 'chrome' })}
        >
          <span className="mh-finish-swatch mh-finish-chrome" aria-hidden="true" /> Chrome
        </button>
      </div>
      <div className="mh-preview-controls">
        <TweakToggleField label="Park hand" checked={parked} onChange={onParked} />
        <TweakToggleField label="Hold press" checked={previewPressed} onChange={onPreviewPressed} />
        <p>{parked ? 'A still preview while you tune. Uncheck to follow the pointer.' : 'Move over the page to try the pointer. Park it to tune in place.'}</p>
      </div>
    </TweakPanel>
  )
}
