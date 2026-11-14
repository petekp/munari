// Wave artwork — inline graphics keep the demo's captured objects self-contained.
const ICON_PATHS = {
  heart:
    'M20.5 4.8a5.4 5.4 0 0 0-7.6 0L12 5.7l-.9-.9a5.4 5.4 0 0 0-7.6 7.6L12 21l8.5-8.6a5.4 5.4 0 0 0 0-7.6Z',
  check: 'm5 12 4 4L19 6',
  trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  undo: 'm8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  file: 'M14 3H5v18h14V8zM14 3v5h5',
  music:
    'M9 18V5l11-2v13M9 7l11-2M9 18c0 2-6 4-6 1s6-4 6-1m11-2c0 2-6 4-6 1s6-4 6-1',
  moon: 'M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z',
} as const

export function WaveIcon({
  name,
  fill = 'none',
}: {
  name: keyof typeof ICON_PATHS
  fill?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

export type WaveArtworkKind =
  'orbit' | 'tide' | 'echo' | 'bloom' | 'pulse' | 'swim'

export function WaveArtwork({
  kind,
  label = '',
}: {
  kind: WaveArtworkKind
  label?: string
}) {
  return (
    <div className={`wave-art wave-art-${kind}`} aria-hidden="true">
      <i />
      <b />
      <span>{label}</span>
    </div>
  )
}

export function WaveHighlight() {
  return (
    <span
      className="wave-highlight"
      data-wave-highlight=""
      aria-hidden="true"
    />
  )
}
