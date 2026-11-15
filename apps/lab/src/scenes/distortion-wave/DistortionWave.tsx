// Distortion wave — six native controls with an independent captured transition layer.
import { useLayoutEffect, useState } from 'react'
import {
  SurfaceCanvas,
  useCaptureHandle,
  useSurfaceSupport,
} from '@petepetrash/munari'
import { WaveHighlight, WaveIcon } from './distortionWaveArtwork'
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
  const [light, setLight] = useState(false)
  const [duration, setDuration] = useState(1800)
  const [palette, setPalette] = useState<WavePalette | 'Auto'>('Auto')
  const wave: WaveAction = (event, update) => {
    const trigger = event.currentTarget
    const content = trigger.dataset.waveContentTarget
    const target = content
      ? trigger
          .closest('.wave-example')
          ?.querySelector<HTMLElement>(`[data-wave-content="${content}"]`)
      : trigger.closest<HTMLElement>('[data-wave-target]')
    if (!target) {
      update()
      return
    }
    const source =
      trigger instanceof HTMLInputElement
        ? (trigger.closest('label') ?? trigger)
        : trigger
    const rect = source.getBoundingClientRect()
    const targetRect = target === source ? rect : target.getBoundingClientRect()
    const native = event.nativeEvent
    const pointer = native instanceof MouseEvent && native.detail > 0
    controller.run({
      target,
      update,
      duration,
      palette: palette === 'Auto' ? controlPalette(trigger) : palette,
      source: new DOMRect(
        rect.left - targetRect.left,
        rect.top - targetRect.top,
        rect.width,
        rect.height,
      ),
      buildupDuration: Number(target.dataset.waveBuildupDuration ?? 0),
      buildupDisplacement: Number(target.dataset.waveBuildupDisplacement ?? 0),
      local: target === source,
      boxless: target.hasAttribute('data-wave-boxless'),
      intensity: 1,
      x:
        (pointer ? native.clientX : rect.left + rect.width / 2) -
        targetRect.left,
      y:
        (pointer ? native.clientY : rect.top + rect.height / 2) -
        targetRect.top,
    })
  }
  return (
    <div className="wave-page" data-theme={light ? 'light' : 'dark'}>
      <div
        className="wave-sheet"
        data-wave-page=""
        data-wave-target=""
        data-wave-buildup-duration="205"
        data-wave-buildup-displacement="64"
      >
        <div className="wave-toolbar">
          <div className="wave-workspace">
            <h1>Night studio</h1>
            <a
              href="https://codepen.io/LukyVj/pen/jEBJpLp"
              target="_blank"
              rel="noreferrer"
            >
              Original by LukyVJ
            </a>
          </div>
          <div className="wave-settings">
            <label>
              Duration
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              >
                <option value={900}>Quick</option>
                <option value={1800}>Normal</option>
                <option value={3600}>Slow</option>
              </select>
            </label>
            <label>
              Palette
              <select
                value={palette}
                onChange={(event) => {
                  const value = event.target.value
                  const validPalette =
                    value === 'Auto' ||
                    value === 'Aurora' ||
                    value === 'Ocean' ||
                    value === 'Mint' ||
                    value === 'Ember' ||
                    value === 'Gold'
                  if (validPalette) setPalette(value)
                }}
              >
                <option value="Auto">Per control</option>
                {Object.keys(WAVE_PALETTES).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="wave-theme"
              aria-label={light ? 'Use dark theme' : 'Use light theme'}
              onClick={(event) =>
                wave(event, () => setLight((value) => !value))
              }
            >
              <WaveIcon name="moon" />
              <WaveHighlight />
            </button>
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
