// Semantic HTML subtrees for Variant 05 (Lateral light bounce):
// - Left reflective navigation sidebar (`<Surface.HTML>` #1)
// - Top reflective path & finish bar (`<Surface.HTML>` #2)
// - Right reflective inspector pane (`<Surface.HTML>` #3)
// - Native center-stage draggable emitter specimens + Finder gallery filmstrip

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSurfaceRefresh } from '@petepetrash/munari'
import type { BouncePosePreset, BounceSeamGaps } from './frontierBounceLaw'
import { BOUNCE_FINISHES, type BounceFinishId } from './frontierBounceNodes'

export type BounceSpecimenId = 'aperture' | 'spectrum' | 'polarity' | 'synth'

export type SynthHueId = 'cyan' | 'magenta' | 'lime' | 'amber'

export interface SynthHueSpec {
  readonly id: SynthHueId
  readonly label: string
  readonly hex: string
  readonly deepHex: string
  readonly accent: string
}

export const SYNTH_HUES: readonly SynthHueSpec[] = [
  { id: 'cyan', label: 'Cyan', hex: '#08bed6', deepHex: '#0676a8', accent: '#7cf4ff' },
  { id: 'magenta', label: 'Laser', hex: '#f22e84', deepHex: '#a8146e', accent: '#ff82bc' },
  { id: 'lime', label: 'Acid', hex: '#5ee31e', deepHex: '#129c52', accent: '#c5ff64' },
  { id: 'amber', label: 'Solar', hex: '#ff8418', deepHex: '#d9381e', accent: '#ffcb52' },
]

export interface SpecimenMeta {
  readonly id: BounceSpecimenId
  readonly fileName: string
  readonly kindLabel: string
  readonly badgeBg: string
  readonly shortLabel: string
}

export const BOUNCE_SPECIMENS: readonly SpecimenMeta[] = [
  {
    id: 'aperture',
    fileName: 'Screenshot 2026-11-09 at 8.06.50 PM.png',
    kindLabel: 'PNG image · Cyan aperture',
    badgeBg: 'linear-gradient(135deg, #09bdd4 0%, #0ac8e0 100%)',
    shortLabel: 'Cyan aperture',
  },
  {
    id: 'spectrum',
    fileName: 'munari-spectrum.html',
    kindLabel: '4-band HTML · Vertical locality',
    badgeBg: 'linear-gradient(180deg, #ff564a 0 25%, #ffaf18 25% 50%, #18db92 50% 75%, #7f5eff 75% 100%)',
    shortLabel: '4-band spectrum',
  },
  {
    id: 'polarity',
    fileName: 'split-polarity.svg',
    kindLabel: 'Dual-edge HTML · Left/right split',
    badgeBg: 'linear-gradient(90deg, #08c4dc 0 50%, #ff5936 50% 100%)',
    shortLabel: 'Split polarity',
  },
  {
    id: 'synth',
    fileName: 'live-emitter-card.tsx',
    kindLabel: 'Interactive HTML · Live controls',
    badgeBg: 'linear-gradient(135deg, #f22e84 0%, #ff8418 100%)',
    shortLabel: 'Live DOM card',
  },
]

interface NavItem {
  readonly id: string
  readonly label: string
  readonly group: 'top' | 'favorites'
  readonly icon: 'clock' | 'shared' | 'app' | 'down' | 'box' | 'folder' | 'desk' | 'doc'
  readonly linkedSpecimen?: BounceSpecimenId
}

export const BOUNCE_NAV_ITEMS: readonly NavItem[] = [
  { id: 'Recents', label: 'Recents', group: 'top', icon: 'clock' },
  { id: 'Shared', label: 'Shared', group: 'top', icon: 'shared' },
  { id: 'Applications', label: 'Applications', group: 'favorites', icon: 'app' },
  { id: 'Downloads', label: 'Downloads', group: 'favorites', icon: 'down' },
  { id: 'Dropbox', label: 'Dropbox', group: 'favorites', icon: 'box' },
  { id: 'Screenshots', label: 'Screenshots', group: 'favorites', icon: 'folder', linkedSpecimen: 'aperture' },
  { id: 'Code', label: 'Code', group: 'favorites', icon: 'folder', linkedSpecimen: 'spectrum' },
  { id: 'sanctuary', label: 'sanctuary', group: 'favorites', icon: 'folder', linkedSpecimen: 'polarity' },
  { id: 'capacitor', label: 'capacitor', group: 'favorites', icon: 'folder', linkedSpecimen: 'synth' },
  { id: 'circuit', label: 'circuit', group: 'favorites', icon: 'folder' },
  { id: 'arc-design-studio', label: 'arc-design-studio', group: 'favorites', icon: 'folder' },
  { id: 'pete-2025', label: 'pete-2025', group: 'favorites', icon: 'folder' },
  { id: 'Desktop', label: 'Desktop', group: 'favorites', icon: 'desk' },
  { id: 'Documents', label: 'Documents', group: 'favorites', icon: 'doc' },
]

function NavGlyph({ kind }: { readonly kind: NavItem['icon'] }) {
  if (kind === 'clock') {
    return (
      <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'shared') {
    return (
      <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="6" cy="6" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.35" />
        <circle cx="10.6" cy="6.5" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.35" />
        <path d="M2.4 12.6c.4-1.9 1.8-3 3.6-3s3.2 1.1 3.6 3M9.6 12.4c.3-1.4 1.3-2.2 2.7-2.2 1 0 1.8.5 2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'app') {
    return (
      <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.4 3.1 12.8M8 2.4l4.9 10.4M4.6 10.1h6.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'down') {
    return (
      <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 5v5.4M5.8 8.4 8 10.6l2.2-2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'box') {
    return (
      <svg className="fb-nav-ico fb-nav-ico--fill" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 2.6 1.8 4.8 5 6.9 8 4.8 5 2.6Zm6 0L8 4.8l3 2.1 3.2-2.1L11 2.6ZM1.8 9l3.2 2.2L8 9 5 6.9 1.8 9Zm9.2 2.2L14.2 9 11 6.9 8 9l3 2.2Z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'desk') {
    return (
      <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.2" y="3.2" width="11.6" height="8.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.35" />
        <path d="M2.4 5.6h11.2M6 13.4h4" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'doc') {
    return (
      <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 2.4h5.3l2.9 2.9v8.3H4V2.4Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        <path d="M9.1 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="fb-nav-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.2 4.4c0-.7.5-1.2 1.2-1.2h2.7l1.3 1.4h5.2c.7 0 1.2.5 1.2 1.2v5.8c0 .7-.5 1.2-1.2 1.2H3.4c-.7 0-1.2-.5-1.2-1.2V4.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BounceNavSidebar({
  supported,
  size,
  activeFolder,
  onSelectFolder,
}: {
  readonly supported: boolean
  readonly size: readonly [number, number]
  readonly activeFolder: string
  readonly onSelectFolder: (folderId: string, linked?: BounceSpecimenId) => void
}) {
  const topItems = BOUNCE_NAV_ITEMS.filter((i) => i.group === 'top')
  const favItems = BOUNCE_NAV_ITEMS.filter((i) => i.group === 'favorites')

  return (
    <div
      className={`fb-nav-root${!supported ? ' fb-glass--fallback' : ''}`}
      style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
    >
      <div className="fb-traffic" aria-hidden="true">
        <span className="fb-dot fb-dot--close" />
        <span className="fb-dot fb-dot--min" />
        <span className="fb-dot fb-dot--max" />
      </div>

      <nav className="fb-nav" aria-label="Finder navigation">
        <ul className="fb-nav-list">
          {topItems.map((item) => {
            const current = item.id === activeFolder
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="fb-nav-btn"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onSelectFolder(item.id, item.linkedSpecimen)}
                >
                  <NavGlyph kind={item.icon} />
                  <span className="fb-nav-label">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="fb-nav-heading">Favorites</div>
        <ul className="fb-nav-list">
          {favItems.map((item) => {
            const current = item.id === activeFolder
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="fb-nav-btn"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onSelectFolder(item.id, item.linkedSpecimen)}
                >
                  <NavGlyph kind={item.icon} />
                  <span className="fb-nav-label">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

export function BounceTopToolbar({
  supported,
  size,
  activeFolder,
  finish,
  boosted,
  onStepSpecimen,
  onSelectFinish,
  onToggleBoost,
}: {
  readonly supported: boolean
  readonly size: readonly [number, number]
  readonly activeFolder: string
  readonly finish: BounceFinishId
  readonly boosted: boolean
  readonly onStepSpecimen: (delta: -1 | 1) => void
  readonly onSelectFinish: (next: BounceFinishId) => void
  readonly onToggleBoost: () => void
}) {
  const finishes: readonly BounceFinishId[] = ['satin', 'obsidian', 'frost']
  return (
    <div
      className={`fb-top-root${!supported ? ' fb-glass--fallback' : ''}`}
      style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
    >
      <div className="fb-top-left">
        <div className="fb-capsule" role="group" aria-label="Step specimen">
          <button
            type="button"
            className="fb-cap-btn"
            aria-label="Previous specimen"
            onClick={() => onStepSpecimen(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="fb-cap-btn"
            aria-label="Next specimen"
            onClick={() => onStepSpecimen(1)}
          >
            ›
          </button>
        </div>
        <span className="fb-path" title={`/Users/petepetrash/${activeFolder}`}>
          /Users/petepetrash/<b>{activeFolder}</b>
        </span>
      </div>

      <div className="fb-top-right">
        <div className="fb-capsule" role="group" aria-label="Reflective glass finish">
          {finishes.map((id) => (
            <button
              key={id}
              type="button"
              className="fb-cap-pill"
              aria-pressed={finish === id}
              onClick={() => onSelectFinish(id)}
            >
              {BOUNCE_FINISHES[id].shortPill}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="fb-boost-btn"
          aria-pressed={boosted}
          onClick={onToggleBoost}
        >
          {boosted ? '1.45×' : '1.0×'}
        </button>
      </div>
    </div>
  )
}

export function BounceInspectorPane({
  supported,
  size,
  specimen,
  finish,
  gaps,
  emitterDims,
  onPosePreset,
}: {
  readonly supported: boolean
  readonly size: readonly [number, number]
  readonly specimen: SpecimenMeta
  readonly finish: BounceFinishId
  readonly gaps: BounceSeamGaps
  readonly emitterDims: readonly [number, number]
  readonly onPosePreset: (preset: BouncePosePreset) => void
}) {
  const refreshSurface = useSurfaceRefresh()
  const [tags, setTags] = useState<string[]>(['liquid-glass', 'light-bounce'])
  const [draft, setDraft] = useState('')
  const mountedRef = useRef(false)

  const tagsKey = tags.join(',')
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    refreshSurface()
  }, [tagsKey, draft, refreshSurface])

  const onSubmitTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = draft.trim().toLowerCase().slice(0, 22)
    if (!clean) return
    setTags((prev) => (prev.includes(clean) ? prev : [...prev.slice(-3), clean]))
    setDraft('')
  }

  return (
    <div
      className={`fb-insp-root${!supported ? ' fb-glass--fallback' : ''}`}
      style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
    >
      <div className="fb-insp-top-group">
        <div className="fb-insp-head">
          <span className="fb-insp-thumb" style={{ background: specimen.badgeBg }} aria-hidden="true">
            {specimen.id === 'aperture' && <span className="fb-insp-thumb-dot" />}
          </span>
          <div className="fb-insp-title-wrap">
            <div className="fb-insp-title">{specimen.fileName}</div>
            <div className="fb-insp-sub">{specimen.kindLabel}</div>
          </div>
        </div>

        <div className="fb-insp-section">
          <div className="fb-insp-sec-head">Information</div>
          <dl className="fb-insp-dl">
            <div className="fb-insp-row">
              <dt>Left nav gap</dt>
              <dd>{gaps.leftPx} px</dd>
            </div>
            <div className="fb-insp-row">
              <dt>Inspector gap</dt>
              <dd>{gaps.rightPx} px</dd>
            </div>
            <div className="fb-insp-row">
              <dt>Top bar gap</dt>
              <dd>{gaps.topPx} px</dd>
            </div>
            <div className="fb-insp-row">
              <dt>Finish</dt>
              <dd>{BOUNCE_FINISHES[finish].label}</dd>
            </div>
            <div className="fb-insp-row">
              <dt>Dimensions</dt>
              <dd>
                {emitterDims[0]} × {emitterDims[1]}
              </dd>
            </div>
          </dl>
        </div>

        <div className="fb-insp-section">
          <div className="fb-insp-sec-head">Tags</div>
          <div className="fb-tag-chips">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="fb-tag-chip"
                title="Remove tag"
                onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
              >
                {t} ×
              </button>
            ))}
          </div>
          <form className="fb-tag-form" onSubmit={onSubmitTag}>
            <input
              type="text"
              className="fb-tag-input"
              placeholder="Add Tags…"
              aria-label="Add inspector tag"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </form>
        </div>
      </div>

      <div className="fb-insp-actions" role="group" aria-label="Snap emitter pose">
        <button type="button" className="fb-act-btn" onClick={() => onPosePreset('hug-nav')}>
          <span className="fb-act-ring" aria-hidden="true">←</span>
          <span>Hug Nav</span>
        </button>
        <button type="button" className="fb-act-btn" onClick={() => onPosePreset('center')}>
          <span className="fb-act-ring" aria-hidden="true">◎</span>
          <span>Center</span>
        </button>
        <button type="button" className="fb-act-btn" onClick={() => onPosePreset('hug-inspector')}>
          <span className="fb-act-ring" aria-hidden="true">→</span>
          <span>Hug Insp</span>
        </button>
      </div>
    </div>
  )
}

export function BounceEmitterSpecimen({
  specimenId,
  synthHue,
  synthNote,
  onSelectSynthHue,
  onChangeSynthNote,
}: {
  readonly specimenId: BounceSpecimenId
  readonly synthHue: SynthHueSpec
  readonly synthNote: string
  readonly onSelectSynthHue: (hue: SynthHueId) => void
  readonly onChangeSynthNote: (next: string) => void
}) {
  if (specimenId === 'spectrum') {
    return (
      <div className="fb-emit-spectrum">
        <div className="fb-spec-band fb-spec-band--coral">
          <span>CORAL · 620 nm</span>
          <span>Top rows</span>
        </div>
        <div className="fb-spec-band fb-spec-band--amber">
          <span>AMBER · 585 nm</span>
          <span>Upper-mid</span>
        </div>
        <div className="fb-spec-band fb-spec-band--mint">
          <span>MINT · 525 nm</span>
          <span>Lower-mid</span>
        </div>
        <div className="fb-spec-band fb-spec-band--violet">
          <span>VIOLET · 450 nm</span>
          <span>Bottom rows</span>
        </div>
      </div>
    )
  }

  if (specimenId === 'polarity') {
    return (
      <div className="fb-emit-polarity">
        <div className="fb-pol-half fb-pol-half--cyan">
          <span className="fb-pol-kicker">← LEFT EDGE</span>
          <strong>Cyan bounce</strong>
        </div>
        <div className="fb-pol-half fb-pol-half--ember">
          <span className="fb-pol-kicker">RIGHT EDGE →</span>
          <strong>Ember bounce</strong>
        </div>
      </div>
    )
  }

  if (specimenId === 'synth') {
    return (
      <div
        className="fb-emit-synth"
        style={{
          background: `radial-gradient(circle at 50% 28%, ${synthHue.accent} 0%, ${synthHue.hex} 54%, ${synthHue.deepHex} 100%)`,
        }}
      >
        <div className="fb-synth-kicker">LIVE NATIVE HTML EMITTER · DRAG OR CLICK</div>
        <input
          type="text"
          className="fb-synth-input"
          aria-label="Live emitter headline"
          value={synthNote}
          onChange={(e) => onChangeSynthNote(e.target.value)}
        />
        <div className="fb-synth-pills" role="group" aria-label="Emitter wavelength">
          {SYNTH_HUES.map((h) => (
            <button
              key={h.id}
              type="button"
              className="fb-synth-pill"
              aria-pressed={h.id === synthHue.id}
              onClick={() => onSelectSynthHue(h.id)}
            >
              <span className="fb-synth-swatch" style={{ background: h.hex }} aria-hidden="true" />
              {h.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="fb-emit-aperture">
      <div className="fb-aperture-bezel">
        <div className="fb-aperture-screen">
          <div className="fb-aperture-disc" />
        </div>
      </div>
    </div>
  )
}

export function BounceFilmstrip({
  activeId,
  onSelect,
}: {
  readonly activeId: BounceSpecimenId
  readonly onSelect: (id: BounceSpecimenId) => void
}) {
  return (
    <div className="fb-filmstrip" role="group" aria-label="Specimen gallery filmstrip">
      {BOUNCE_SPECIMENS.map((item) => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            className="fb-film-btn"
            aria-label={item.shortLabel}
            aria-pressed={active}
            title={item.shortLabel}
            onClick={() => onSelect(item.id)}
          >
            <span className="fb-film-art" style={{ background: item.badgeBg }} aria-hidden="true">
              {item.id === 'aperture' && <span className="fb-film-disc" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
