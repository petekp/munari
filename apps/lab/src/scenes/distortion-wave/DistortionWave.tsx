// Distortion wave — six native controls with an independent captured transition layer.
import { useLayoutEffect, useState } from 'react'
import {
  SurfaceCanvas,
  useCaptureHandle,
  useSurfaceSupport,
} from '@petepetrash/munari'
import { Button, Select } from '../../components/system'
import { announcePageReady } from '../../components/siteOpening'
import {
  DistortionWaveEffect,
  type WaveController,
} from './distortionWaveEffect'
import { WaveExamples, type WaveAction } from './distortionWaveExamples'
import { WAVE_PALETTES, type WavePalette } from './distortionWaveNodes'
import './distortionWave.css'

function controlPalette(trigger: HTMLElement): WavePalette {
  const value = trigger.dataset.wavePalette
  if (
    value === 'Ocean' ||
    value === 'Ember' ||
    value === 'Mint' ||
    value === 'Gold'
  )
    return value
  return 'Aurora'
}

export function DistortionWaveApp() {
  useLayoutEffect(announcePageReady, [])
  const capture = useCaptureHandle()
  const supported = useSurfaceSupport()
  const [controller] = useState<WaveController>(() => ({
    run: (request) => request.update(),
  }))
  const [light, setLight] = useState(true)
  const [duration, setDuration] = useState(1800)
  const [palette, setPalette] = useState<WavePalette | 'Auto'>('Auto')
  const wave: WaveAction = (event, update) => {
    const trigger = event.currentTarget
    const target = trigger.closest<HTMLElement>('[data-wave-target]')
    if (!target) {
      update()
      return
    }
    const source =
      trigger instanceof HTMLInputElement
        ? (trigger.closest('label') ?? trigger)
        : trigger
    const rect = source.getBoundingClientRect()
    const native = event.nativeEvent
    const pointer = native instanceof MouseEvent && native.detail > 0
    controller.run({
      target,
      update,
      duration,
      palette: palette === 'Auto' ? controlPalette(trigger) : palette,
      source: rect,
      local: target === source,
      boxless: target.hasAttribute('data-wave-boxless'),
      intensity: 1,
      x: pointer ? native.clientX : rect.left + rect.width / 2,
      y: pointer ? native.clientY : rect.top + rect.height / 2,
    })
  }
  return (
    <div
      className="wave-page"
      data-theme={light ? 'light' : 'dark'}
      data-ground={light ? 'paper' : 'ink'}
    >
      <div className="wave-sheet" data-wave-page="" data-wave-target="">
        <div className="wave-toolbar">
          <a
            className="m-link m-small m-quiet"
            href="https://codepen.io/LukyVj/pen/jEBJpLp"
            target="_blank"
            rel="noreferrer"
          >
            Original by LukyVJ ↗
          </a>
          <div className="wave-settings">
            <label className="m-small">
              Duration
              <Select
                value={String(duration)}
                options={[
                  ['900', 'Quick'],
                  ['1800', 'Normal'],
                  ['3600', 'Slow'],
                ]}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
            <label className="m-small">
              Palette
              <Select
                value={palette}
                options={[
                  ['Auto', 'Per control'],
                  ...Object.keys(WAVE_PALETTES).map(
                    (value): [string, string] => [value, value],
                  ),
                ]}
                onChange={(event) => {
                  const value = event.target.value
                  if (
                    value === 'Aurora' ||
                    value === 'Ocean' ||
                    value === 'Ember' ||
                    value === 'Mint' ||
                    value === 'Gold' ||
                    value === 'Auto'
                  )
                    setPalette(value)
                }}
              />
            </label>
            <Button
              variant="outline"
              compact
              className="wave-theme"
              aria-label={light ? 'Use dark theme' : 'Use light theme'}
              onClick={(event) =>
                wave(event, () => setLight((value) => !value))
              }
            >
              {light ? 'Dark' : 'Light'}
            </Button>
          </div>
        </div>
        <main className="wave-grid" aria-label="Distortion wave examples">
          <WaveExamples wave={wave} />
        </main>
      </div>
      {supported && (
        <div className="wave-overlay" aria-hidden="true">
          <SurfaceCanvas
            pointerMode="surfaces"
            frameloop="demand"
            gl={{ alpha: true, antialias: false, depth: false }}
            camera={{ position: [0, 0, 5] }}
          >
            <DistortionWaveEffect capture={capture} controller={controller} />
          </SurfaceCanvas>
        </div>
      )}
    </div>
  )
}
