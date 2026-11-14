// Wave examples — six native interactions with scene-owned state and capture targets.
import { useState, type MouseEvent } from 'react'
import { Button, CHECK_MARK } from '../../components/system'
import './distortionWaveExamples.css'

export interface WaveTrigger {
  currentTarget: HTMLElement
  nativeEvent: Event
}
export type WaveAction = (event: WaveTrigger, update: () => void) => void
interface ExampleProps {
  wave: WaveAction
}

const COPY_TEXT = 'npm i @petepetrash/munari'
const TASKS = ['Sketch the interaction', 'Tune the wave', 'Ship the demo']
const COLORS = [
  { name: 'Violet', value: '#b47deb', palette: 'Aurora' },
  { name: 'Coral', value: '#f2695c', palette: 'Ember' },
  { name: 'Sky', value: '#52c7f2', palette: 'Ocean' },
  { name: 'Leaf', value: '#66c94e', palette: 'Mint' },
] as const

function WaveLike({ wave }: ExampleProps) {
  const [liked, setLiked] = useState(false)
  return (
    <Button
      variant="outline"
      className="wave-like"
      data-wave-target=""
      data-wave-palette="Ember"
      aria-label="Like"
      aria-pressed={liked}
      onClick={(event) => wave(event, () => setLiked((value) => !value))}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill={liked ? 'currentColor' : 'none'}
      >
        <path d="M20.5 4.8a5.4 5.4 0 0 0-7.6 0L12 5.7l-.9-.9a5.4 5.4 0 0 0-7.6 7.6L12 21l8.5-8.6a5.4 5.4 0 0 0 0-7.6Z" />
      </svg>
      <span>{liked ? 129 : 128}</span>
    </Button>
  )
}

function WaveDelete({ wave }: ExampleProps) {
  const [deleted, setDeleted] = useState(false)
  return (
    <div className="wave-delete" data-wave-target="" data-wave-boxless="">
      <span aria-live="polite">
        {deleted ? 'Draft deleted' : 'Draft notes'}
      </span>
      <Button
        variant="outline"
        compact
        data-wave-palette={deleted ? 'Mint' : 'Ember'}
        onClick={(event) => wave(event, () => setDeleted((value) => !value))}
      >
        {deleted ? 'Undo' : 'Delete'}
      </Button>
    </div>
  )
}

function WaveCopy({ wave }: ExampleProps) {
  const [status, setStatus] = useState<'ready' | 'copied' | 'failed'>('ready')
  const copy = (event: MouseEvent<HTMLButtonElement>) => {
    const trigger = {
      currentTarget: event.currentTarget,
      nativeEvent: event.nativeEvent,
    }
    if (!navigator.clipboard) {
      wave(trigger, () => setStatus('failed'))
      return
    }
    void navigator.clipboard.writeText(COPY_TEXT).then(
      () => wave(trigger, () => setStatus('copied')),
      () => wave(trigger, () => setStatus('failed')),
    )
  }
  const labels = { ready: 'Copy', copied: 'Copied', failed: 'Try again' }
  return (
    <div className="wave-copy">
      <code>{COPY_TEXT}</code>
      <Button
        variant="outline"
        compact
        data-wave-target=""
        data-wave-palette="Ocean"
        onClick={copy}
      >
        <span aria-live="polite">{labels[status]}</span>
      </Button>
      {status === 'failed' && (
        <span className="wave-copy-status m-small m-quiet" role="status">
          Clipboard unavailable.
        </span>
      )}
    </div>
  )
}

function WaveFilters({ wave }: ExampleProps) {
  const [filters, setFilters] = useState(['Design'])
  return (
    <div className="wave-filters" role="group" aria-label="Filters">
      {['Design', 'Motion', 'Code'].map((filter) => {
        const selected = filters.includes(filter)
        return (
          <Button
            key={filter}
            variant={selected ? 'solid' : 'outline'}
            compact
            className="wave-chip"
            data-wave-target=""
            aria-pressed={selected}
            onClick={(event) =>
              wave(event, () =>
                setFilters((values) =>
                  values.includes(filter)
                    ? values.filter((value) => value !== filter)
                    : [...values, filter],
                ),
              )
            }
          >
            {filter}
          </Button>
        )
      })}
    </div>
  )
}

function WaveChecklist({ wave }: ExampleProps) {
  const [completed, setCompleted] = useState<string[]>([])
  return (
    <div className="wave-checklist" data-wave-target="" data-wave-boxless="">
      <output
        className="m-readout m-quiet"
        aria-label="Completed tasks"
        aria-live="polite"
      >
        {completed.length} / {TASKS.length}
      </output>
      {TASKS.map((task) => {
        const checked = completed.includes(task)
        return (
          <label key={task} className="m-check" data-checked={checked}>
            <input
              type="checkbox"
              checked={checked}
              data-wave-palette="Mint"
              onChange={(event) =>
                wave(event, () =>
                  setCompleted((values) =>
                    values.includes(task)
                      ? values.filter((value) => value !== task)
                      : [...values, task],
                  ),
                )
              }
            />
            <span className="m-check-box">{CHECK_MARK}</span>
            <span>{task}</span>
          </label>
        )
      })}
    </div>
  )
}

function WaveColor({ wave }: ExampleProps) {
  const [selected, setSelected] = useState(0)
  const color = COLORS[selected]
  return (
    <div className="wave-color" data-wave-target="">
      <div className="wave-color-patch" style={{ background: color.value }} />
      <div className="wave-color-options">
        <span className="m-small" aria-live="polite">
          {color.name}
        </span>
        <div role="group" aria-label="Color">
          {COLORS.map((option, index) => (
            <button
              key={option.name}
              type="button"
              className="wave-swatch"
              aria-label={option.name}
              aria-pressed={selected === index}
              data-wave-palette={option.palette}
              onClick={(event) => wave(event, () => setSelected(index))}
            >
              <span style={{ background: option.value }} />
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
