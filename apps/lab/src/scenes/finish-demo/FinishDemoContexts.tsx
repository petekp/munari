// Finish demo contexts — four kinds of UI that wear a finish: a settings
// form, a product card, a dashboard tile and a media control.
//
// Each is ordinary HTML with its own state, so typing, focus and clicks are
// the browser's on the page copy and on the finished Surface alike. Each
// content root declares its own size (docs/authoring.md), set by its class.

import { useState } from 'react'
import { FinishedCard } from './FinishDemoStage'
import type { BenchCard, PageSetup } from './finishDemoRecipe'

export function SettingsForm() {
  const [name, setName] = useState('Field recordings')
  const [kept, setKept] = useState(14)
  const [summary, setSummary] = useState(true)
  const [saved, setSaved] = useState<string | null>(null)
  return (
    <form
      className="fd-stack"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(name)
      }}
    >
      <p className="mf-label">Workspace settings</p>
      <label className="fd-field">
        <span className="mf-fine">Workspace name</span>
        <input className="mf-input" type="text" autoComplete="organization" required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="fd-field fd-field--inline">
        <span className="mf-fine">Backups kept</span>
        <input
          className="mf-input fd-number"
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          step={1}
          required
          value={kept}
          onChange={(event) => setKept(event.target.valueAsNumber)}
        />
      </label>
      <label className="fd-check">
        <input type="checkbox" checked={summary} onChange={(event) => setSummary(event.target.checked)} />
        <span className="mf-fine">Email me a weekly summary</span>
      </label>
      <div className="mf-row">
        <span className="mf-fine">{saved === null ? 'Not saved' : `Saved “${saved}”`}</span>
        <button type="submit" className="mf-button mf-button--solid">Save</button>
      </div>
    </form>
  )
}

export function ProductCard() {
  const [bag, setBag] = useState(0)
  return (
    <div className="fd-stack">
      <p className="mf-label">Field recorder</p>
      <h2 className="mf-title">FR-2 Portable</h2>
      <p className="mf-body">Two balanced inputs, 32-bit float capture and a case that survives the bag.</p>
      <p className="mf-fine">Ships in 3–5 days · 2-year warranty</p>
      <div className="mf-row">
        <span className="mf-price">$649</span>
        <button type="button" className="mf-button mf-button--solid" onClick={() => setBag((count) => count + 1)}>
          {bag === 0 ? 'Add to bag' : `In bag: ${bag}`}
        </button>
      </div>
    </div>
  )
}

const ORDERS = {
  day: { total: '1,284', change: '+12% on last Tuesday', points: [14, 18, 16, 22, 21, 27, 25, 31, 30, 36] },
  week: { total: '8,917', change: '+4% on last week', points: [30, 28, 33, 31, 35, 34, 38, 36, 39, 41] },
} as const

type OrdersRange = keyof typeof ORDERS

function sparkline(points: readonly number[]): string {
  const low = Math.min(...points)
  const high = Math.max(...points)
  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * 236
      const y = 44 - ((value - low) / (high - low)) * 40
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function DashboardTile() {
  const [range, setRange] = useState<OrdersRange>('day')
  const orders = ORDERS[range]
  return (
    <div className="fd-stack">
      <div className="mf-row fd-row--top">
        <p className="mf-label">Orders</p>
        <div className="mf-segments fd-segments--small" role="group" aria-label="Range">
          {(['day', 'week'] as const).map((item) => (
            <button key={item} type="button" className="mf-segment" aria-pressed={range === item} onClick={() => setRange(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <p className="mf-readout">{orders.total}</p>
      <p className="mf-fine">{orders.change}</p>
      <svg className="fd-spark" viewBox="0 0 236 48" aria-hidden>
        <path d={sparkline(orders.points)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// The track's length, seconds.
const TRACK_SECONDS = 214

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function MediaControl() {
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(71)
  return (
    <div className="fd-stack">
      <div className="mf-row fd-row--top">
        <div>
          <p className="mf-label">Now playing</p>
          <p className="fd-track">Morning take, room 2</p>
        </div>
        <button type="button" className="mf-button mf-button--solid fd-play" aria-pressed={playing} onClick={() => setPlaying((on) => !on)}>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <label className="fd-field">
        <span className="fd-visually-hidden">Position</span>
        <input
          className="fd-scrub"
          type="range"
          min={0}
          max={TRACK_SECONDS}
          step={1}
          value={position}
          onChange={(event) => setPosition(event.target.valueAsNumber)}
        />
      </label>
      <div className="mf-row">
        <span className="mf-fine">{clock(position)}</span>
        <span className="mf-fine">{clock(TRACK_SECONDS)}</span>
      </div>
    </div>
  )
}

export const CONTEXTS = [
  { id: 'settings', label: 'Settings form', content: 'SettingsForm', Content: SettingsForm },
  { id: 'product', label: 'Product card', content: 'ProductCard', Content: ProductCard },
  { id: 'tile', label: 'Dashboard tile', content: 'DashboardTile', Content: DashboardTile },
  { id: 'media', label: 'Media control', content: 'MediaControl', Content: MediaControl },
] as const

export type ContextId = (typeof CONTEXTS)[number]['id']

export function contextOf(id: ContextId): (typeof CONTEXTS)[number] {
  const found = CONTEXTS.find((item) => item.id === id)
  if (!found) throw new Error(`No finish demo context ${id}`)
  return found
}

interface ContextCardProps {
  readonly card: BenchCard
  readonly page: PageSetup
}

/** One context on a finished Surface. */
export function ContextCard({ card, page }: ContextCardProps) {
  const { Content } = contextOf(card.context)
  return (
    <FinishedCard card={card} page={page}>
      <Content />
    </FinishedCard>
  )
}
