// Wave examples — filled, bounded objects give each transition a visible surface.
import { useState, type MouseEvent } from 'react'
import {
  WaveArtwork,
  WaveHighlight,
  WaveIcon,
  type WaveArtworkKind,
} from './distortionWaveArtwork'
import './distortionWaveExamples.css'

export interface WaveTrigger {
  currentTarget: HTMLElement
  nativeEvent: Event
}
export type WaveAction = (event: WaveTrigger, update: () => void) => void
interface ExampleProps {
  wave: WaveAction
}

const INVITE_CODE = 'NIGHT-8K2M'
const COPY_STATES = {
  ready: {
    caption: 'Listening party',
    title: ['Night Swim', 'After hours.'],
    action: 'Copy invite',
    announcement: '',
  },
  copied: {
    caption: 'You’re ready to share',
    title: ['Invite copied.', 'See you there.'],
    action: 'Copied',
    announcement: 'Invitation code copied.',
  },
  failed: {
    caption: 'Clipboard unavailable',
    title: ['Could not copy.', 'Try again.'],
    action: 'Try again',
    announcement: 'Clipboard unavailable. Try again.',
  },
} as const
const TASKS = [
  { title: 'Cover artwork', detail: '1600 × 1600 PNG', icon: 'file' },
  { title: 'Audio master', detail: 'Final WAV export', icon: 'music' },
  { title: 'Credits', detail: 'Artists and collaborators', icon: 'heart' },
] as const
const FINISHES = [
  { name: 'Orchid', value: '#ba99d8', palette: 'Aurora' },
  { name: 'Lagoon', value: '#65b8b4', palette: 'Mint' },
  { name: 'Papaya', value: '#ed9c7d', palette: 'Ember' },
  { name: 'Silver', value: '#b8c8d6', palette: 'Ocean' },
] as const
const ASSETS: readonly {
  name: string
  kind: WaveArtworkKind
  type: 'Artwork' | 'Loops'
}[] = [
  { name: 'Orbit', kind: 'orbit', type: 'Artwork' },
  { name: 'Low tide', kind: 'tide', type: 'Loops' },
  { name: 'Echo', kind: 'echo', type: 'Artwork' },
  { name: 'Bloom', kind: 'bloom', type: 'Artwork' },
  { name: 'Soft pulse', kind: 'pulse', type: 'Loops' },
  { name: 'Night swim', kind: 'swim', type: 'Loops' },
]
const WAVEFORM = [9, 18, 12, 27, 34, 22, 14, 30, 18, 25, 10, 20, 31, 15, 8]

function WaveLike({ wave }: ExampleProps) {
  const [liked, setLiked] = useState(false)
  return (
    <div className="wave-album">
      <WaveArtwork kind="swim" label="night swim" />
      <div className="wave-album-caption">
        <div>
          <strong>Night Swim</strong>
          <small>Rhea Sol · New single</small>
        </div>
        <button
          type="button"
          className="wave-like"
          data-wave-target=""
          data-wave-palette="Ember"
          aria-label="Like Night Swim"
          aria-pressed={liked}
          onClick={(event) => wave(event, () => setLiked((value) => !value))}
        >
          <WaveIcon name="heart" fill={liked ? 'currentColor' : 'none'} />
          <span>{liked ? 'Loved' : 'Like'}</span>
          <b>{liked ? 129 : 128}</b>
          <WaveHighlight />
        </button>
      </div>
    </div>
  )
}

function WaveDelete({ wave }: ExampleProps) {
  const [deleted, setDeleted] = useState(false)
  return (
    <div className="wave-file-tray">
      <div className="wave-context-line">Recent file</div>
      <div className="wave-delete" data-wave-target="" data-deleted={deleted}>
        <div className="wave-file-visual">
          {deleted ? <WaveIcon name="trash" /> : <WaveArtwork kind="orbit" />}
        </div>
        <div className="wave-file-copy" aria-live="polite">
          <strong>{deleted ? 'Moved to trash' : 'Cover exploration 03'}</strong>
          <small>{deleted ? 'Cover exploration 03' : 'Artwork · 2.4 MB'}</small>
        </div>
        <button
          type="button"
          className="wave-delete-action"
          aria-label={deleted ? 'Undo delete' : 'Delete file'}
          data-wave-palette={deleted ? 'Mint' : 'Ember'}
          onClick={(event) => wave(event, () => setDeleted((value) => !value))}
        >
          <WaveIcon name={deleted ? 'undo' : 'trash'} />
          {deleted && <span>Undo</span>}
          <WaveHighlight />
        </button>
      </div>
    </div>
  )
}

function WaveCopy({ wave }: ExampleProps) {
  const [status, setStatus] = useState<'ready' | 'copied' | 'failed'>('ready')
  const copied = status === 'copied'
  const copy = (event: MouseEvent<HTMLButtonElement>) => {
    const trigger = {
      currentTarget: event.currentTarget,
      nativeEvent: event.nativeEvent,
    }
    if (!navigator.clipboard) {
      wave(trigger, () => setStatus('failed'))
      return
    }
    void navigator.clipboard.writeText(INVITE_CODE).then(
      () => wave(trigger, () => setStatus('copied')),
      () => wave(trigger, () => setStatus('failed')),
    )
  }
  const content = COPY_STATES[status]
  return (
    <div className="wave-copy-wrap">
      <button
        type="button"
        className="wave-copy"
        data-wave-target=""
        data-wave-palette="Mint"
        data-copy-state={status}
        aria-label="Copy invitation code"
        onClick={copy}
      >
        <span className="wave-pass-top">
          <span className="wave-pass-icon">
            <WaveIcon name={copied ? 'check' : 'music'} />
          </span>
          <span>{content.caption}</span>
          <span className="wave-pass-action">
            <WaveIcon name={copied ? 'check' : 'copy'} />
          </span>
        </span>
        <span className="wave-pass-title">
          {content.title[0]}
          <br />
          {content.title[1]}
        </span>
        <span className="wave-pass-bottom">
          <code>{INVITE_CODE}</code>
          <span>
            {content.action}
            <WaveIcon name={copied ? 'check' : 'copy'} />
          </span>
        </span>
        <WaveHighlight />
      </button>
      <span className="wave-status" role="status">
        {content.announcement}
      </span>
    </div>
  )
}

function WaveFilters({ wave }: ExampleProps) {
  const [filter, setFilter] = useState<'All' | 'Artwork' | 'Loops'>('All')
  const assets = ASSETS.filter(
    (asset) => filter === 'All' || asset.type === filter,
  )
  return (
    <div className="wave-filters" data-wave-target="">
      <div className="wave-collection-top">
        <strong>Release assets</strong>
        <span aria-live="polite">{assets.length} pieces</span>
      </div>
      <div
        className="wave-filter-tabs"
        role="group"
        aria-label="Filter collection"
      >
        {(['All', 'Artwork', 'Loops'] as const).map((type) => (
          <button
            type="button"
            className="wave-chip"
            key={type}
            aria-pressed={filter === type}
            data-wave-palette="Ocean"
            onClick={(event) => wave(event, () => setFilter(type))}
          >
            {type}
            <WaveHighlight />
          </button>
        ))}
      </div>
      <div className="wave-assets" data-filtered={filter !== 'All'}>
        {assets.map((asset) => (
          <div className="wave-asset" key={asset.name}>
            <WaveArtwork kind={asset.kind} />
            <span>{asset.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function WaveChecklist({ wave }: ExampleProps) {
  const [completed, setCompleted] = useState<string[]>([])
  return (
    <div className="wave-checklist">
      <div className="wave-context-line">
        <strong>Ready for release</strong>
      </div>
      {TASKS.map((task) => {
        const checked = completed.includes(task.title)
        return (
          <label
            key={task.title}
            className="wave-check-row"
            data-wave-target=""
            data-checked={checked}
          >
            <input
              type="checkbox"
              aria-label={task.title}
              checked={checked}
              data-wave-palette="Mint"
              onChange={(event) =>
                wave(event, () =>
                  setCompleted((values) =>
                    values.includes(task.title)
                      ? values.filter((value) => value !== task.title)
                      : [...values, task.title],
                  ),
                )
              }
            />
            <span className="wave-task-icon">
              <WaveIcon name={task.icon} />
            </span>
            <span className="wave-task-copy">
              <strong>{task.title}</strong>
              <small>{checked ? 'Ready' : task.detail}</small>
            </span>
            <span className="wave-task-check">
              <WaveIcon name="check" />
            </span>
            <WaveHighlight />
          </label>
        )
      })}
    </div>
  )
}

function WaveColor({ wave }: ExampleProps) {
  const [selected, setSelected] = useState(0)
  const finish = FINISHES[selected]
  return (
    <div className="wave-color">
      <div
        className="wave-color-player"
        data-wave-content="player"
        data-wave-target=""
        style={{ backgroundColor: finish.value }}
        role="img"
        aria-label={`${finish.name} pocket player`}
      >
        <div className="wave-player-top">
          <span>pocket</span>
          <small className="wave-color-name" aria-live="polite">
            {finish.name}
          </small>
          <i />
          <i />
          <i />
        </div>
        <div className="wave-player-screen">
          <div>
            <span>Night Swim</span>
            <small>Rhea Sol</small>
          </div>
          <div className="wave-player-waveform">
            {WAVEFORM.map((height, index) => (
              <i key={index} style={{ height }} />
            ))}
          </div>
          <div className="wave-player-time">
            <span>0:42</span>
            <span>3:18</span>
          </div>
        </div>
        <div className="wave-player-grille">
          <span />
          <div className="wave-player-speaker" />
          <span />
        </div>
      </div>
      <div className="wave-color-options">
        <span>Finish</span>
        <div role="group" aria-label="Player finish">
          {FINISHES.map((option, index) => (
            <button
              key={option.name}
              type="button"
              className="wave-swatch"
              data-wave-content-target="player"
              data-wave-palette={option.palette}
              aria-label={option.name}
              aria-pressed={selected === index}
              onClick={(event) => wave(event, () => setSelected(index))}
            >
              <span style={{ background: option.value }} />
              <WaveHighlight />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const EXAMPLES = [
  { title: 'Like', Component: WaveLike },
  { title: 'Delete / undo', Component: WaveDelete },
  { title: 'Copy', Component: WaveCopy },
  { title: 'Filters', Component: WaveFilters },
  { title: 'Checklist', Component: WaveChecklist },
  { title: 'Color', Component: WaveColor },
]

export function WaveExamples({ wave }: ExampleProps) {
  return EXAMPLES.map(({ title, Component }) => (
    <section key={title} className="wave-example" aria-label={title}>
      <h2>{title}</h2>
      <div className="wave-example-content">
        <Component wave={wave} />
      </div>
    </section>
  ))
}
