// Distortion wave — Lucas Bonomi's UI effect, drawn with Munari capture and TSL.
// React owns the controls; the overlay only draws their outgoing appearance.
import {
  useLayoutEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  SurfaceCanvas,
  useElementCapture,
  useSurfaceSupport,
} from '@petepetrash/munari'
import {
  DistortionWaveEffect,
  type WaveController,
} from './distortionWaveEffect'
import { WAVE_PALETTES, type WavePalette } from './distortionWaveNodes'
import { announcePageReady } from '../../components/siteOpening'
import './distortionWave.css'

type WaveAction = (event: MouseEvent<HTMLElement>, update: () => void) => void
interface ControlsProps {
  wave: WaveAction
}
interface CardProps {
  title: string
  children: ReactNode
  wide?: boolean
}

function Card({ title, children, wide = false }: CardProps) {
  return (
    <section className={`wave-card${wide ? ' wave-card-tall' : ''}`}>
      <h2>{title}</h2>
      <div className="wave-card-content">{children}</div>
    </section>
  )
}

function WaveButtons({ wave }: ControlsProps) {
  const [liked, setLiked] = useState(false)
  const [followed, setFollowed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [votes, setVotes] = useState(42)
  return (
    <>
      <Card title="Like">
        <button
          className="wave-pill wave-like"
          aria-label="Like"
          aria-pressed={liked}
          onClick={(event) => wave(event, () => setLiked((value) => !value))}
        >
          <span aria-hidden="true">{liked ? '♥' : '♡'}</span>{' '}
          {liked ? 129 : 128}
        </button>
      </Card>
      <Card title="Follow">
        <div className="wave-person">
          <span className="wave-avatar">LB</span>
          <div>
            <strong>Lucas Bonomi</strong>
            <small>@LukyVj</small>
          </div>
          <button
            className="wave-pill"
            aria-pressed={followed}
            onClick={(event) =>
              wave(event, () => setFollowed((value) => !value))
            }
          >
            {followed ? 'Following' : 'Follow'}
          </button>
        </div>
      </Card>
      <Card title="Bookmark">
        <button
          className="wave-pill"
          aria-pressed={saved}
          onClick={(event) => wave(event, () => setSaved((value) => !value))}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 3h12v18l-6-4-6 4z"
              fill={saved ? 'currentColor' : 'none'}
            />
          </svg>
          {saved ? 'Saved' : 'Save'}
        </button>
      </Card>
      <Card title="Vote">
        <div className="wave-stepper">
          <button
            aria-label="Upvote"
            onClick={(event) =>
              wave(event, () => setVotes((value) => value + 1))
            }
          >
            ▴
          </button>
          <output aria-live="polite">{votes}</output>
          <button
            aria-label="Downvote"
            onClick={(event) =>
              wave(event, () => setVotes((value) => value - 1))
            }
          >
            ▾
          </button>
        </div>
      </Card>
    </>
  )
}

function WaveSelections({ wave }: ControlsProps) {
  const [notifications, setNotifications] = useState(true)
  const [filters, setFilters] = useState(['Design'])
  const [plan, setPlan] = useState('Starter')
  const [rating, setRating] = useState(0)
  return (
    <>
      <Card title="Settings">
        <div className="wave-setting">
          <div>
            <strong>Email notifications</strong>
            <small>Mentions and replies</small>
          </div>
          <button
            className="wave-switch"
            role="switch"
            aria-label="Email notifications"
            aria-checked={notifications}
            onClick={(event) =>
              wave(event, () => setNotifications((value) => !value))
            }
          >
            <span />
          </button>
        </div>
      </Card>
      <Card title="Filters">
        <div className="wave-filters">
          {['Design', 'WebGPU', 'CSS', 'Motion'].map((filter) => (
            <button
              key={filter}
              className="wave-chip"
              aria-pressed={filters.includes(filter)}
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
            </button>
          ))}
        </div>
      </Card>
      <Card title="Plan">
        <div className="wave-plan">
          {['Starter', 'Pro', 'Team'].map((value) => (
            <button
              key={value}
              aria-pressed={plan === value}
              onClick={(event) => wave(event, () => setPlan(value))}
            >
              <span className="wave-radio" />
              <span>{value}</span>
              <small>
                {value === 'Starter'
                  ? 'Free'
                  : value === 'Pro'
                    ? '$12/mo'
                    : '$40/mo'}
              </small>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Rating">
        <div className="wave-stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
              aria-pressed={rating === value}
              data-filled={rating >= value}
              onClick={(event) => wave(event, () => setRating(value))}
            >
              ★
            </button>
          ))}
        </div>
        <small className="wave-rating-label">
          {rating ? `${rating} out of 5` : 'Tap to rate'}
        </small>
      </Card>
    </>
  )
}

function WaveContent({ wave }: ControlsProps) {
  const [yearly, setYearly] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [color, setColor] = useState('Violet')
  const [playing, setPlaying] = useState(false)
  return (
    <>
      <Card title="Pricing" wide>
        <div className="wave-segment">
          <button
            aria-pressed={!yearly}
            onClick={(event) => wave(event, () => setYearly(false))}
          >
            Monthly
          </button>
          <button
            aria-pressed={yearly}
            onClick={(event) => wave(event, () => setYearly(true))}
          >
            Yearly
          </button>
        </div>
        <p className="wave-price">
          ${yearly ? 9 : 12}
          <small> / month</small>
        </p>
        <small>{yearly ? 'Billed yearly · Save 25%' : 'Billed monthly'}</small>
      </Card>
      <Card title="Quantity" wide>
        <div className="wave-product-icon" aria-hidden="true">
          ✳
        </div>
        <strong>Studio notebook</strong>
        <div className="wave-quantity">
          <div className="wave-stepper">
            <button
              aria-label="Less"
              disabled={quantity === 1}
              onClick={(event) =>
                wave(event, () =>
                  setQuantity((value) => Math.max(1, value - 1)),
                )
              }
            >
              −
            </button>
            <output aria-live="polite">{quantity}</output>
            <button
              aria-label="More"
              onClick={(event) =>
                wave(event, () => setQuantity((value) => value + 1))
              }
            >
              +
            </button>
          </div>
          <strong>${quantity * 18}</strong>
        </div>
      </Card>
      <Card title="Colour" wide>
        <div className="wave-colour-preview" data-color={color} />
        <strong>{color}</strong>
        <div className="wave-swatches">
          {['Violet', 'Coral', 'Lagoon', 'Sun'].map((value) => (
            <button
              key={value}
              aria-label={value}
              data-color={value}
              aria-pressed={color === value}
              onClick={(event) => wave(event, () => setColor(value))}
            />
          ))}
        </div>
      </Card>
      <Card title="Player" wide>
        <div className="wave-album" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="wave-player">
          <div>
            <strong>Night Drive</strong>
            <small>{playing ? 'Playing' : 'Paused'}</small>
          </div>
          <button
            className="wave-play"
            aria-label={playing ? 'Pause' : 'Play'}
            aria-pressed={playing}
            onClick={(event) =>
              wave(event, () => setPlaying((value) => !value))
            }
          >
            {playing ? 'Ⅱ' : '▶'}
          </button>
        </div>
      </Card>
    </>
  )
}

export function DistortionWaveApp() {
  useLayoutEffect(announcePageReady, [])
  const capture = useElementCapture()
  const supported = useSurfaceSupport()
  const [controller] = useState<WaveController>(() => ({
    run: (request) => request.update(),
  }))
  const [light, setLight] = useState(false)
  const [duration, setDuration] = useState(1800)
  const [palette, setPalette] = useState<WavePalette>('Aurora')
  const wave: WaveAction = (event, update) => {
    const trigger = event.currentTarget
    const target = trigger.closest<HTMLElement>('[data-wave-page], .wave-card')
    if (!target) {
      update()
      return
    }
    const rect = trigger.getBoundingClientRect()
    const keyboard = event.detail === 0
    controller.run({
      target,
      update,
      duration,
      palette,
      intensity: 1,
      x: keyboard ? rect.left + rect.width / 2 : event.clientX,
      y: keyboard ? rect.top + rect.height / 2 : event.clientY,
    })
  }
  return (
    <div className="wave-page" data-theme={light ? 'light' : 'dark'}>
      <div className="wave-sheet" data-wave-page="">
        <header className="wave-header">
          <a className="wave-brand" href="?scene=home">
            <span className="wave-logo" />
            munari <span className="wave-divider">/</span>{' '}
            <span>experiments</span>
          </a>
          <button
            className="wave-theme"
            aria-label={light ? 'Use dark theme' : 'Use light theme'}
            onClick={(event) => wave(event, () => setLight((value) => !value))}
          >
            {light ? '☾' : '☀'}
          </button>
        </header>
        <div className="wave-intro">
          <div>
            <h1>Distortion wave</h1>
            <p>
              Click a control. Watch its state change through a wave of light.
            </p>
          </div>
          <a
            href="https://codepen.io/LukyVj/pen/jEBJpLp"
            target="_blank"
            rel="noreferrer"
          >
            Original by LukyVJ ↗
          </a>
        </div>
        <div className="wave-toolbar">
          <span>Try a click, or Tab and Enter.</span>
          <label>
            Duration{' '}
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
            Palette{' '}
            <select
              value={palette}
              onChange={(event) => {
                const value = event.target.value
                if (
                  value === 'Aurora' ||
                  value === 'Ocean' ||
                  value === 'Ember'
                )
                  setPalette(value)
              }}
            >
              {Object.keys(WAVE_PALETTES).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <main className="wave-grid">
          <WaveButtons wave={wave} />
          <WaveSelections wave={wave} />
          <WaveContent wave={wave} />
        </main>
        <footer className="wave-footer">
          <span>HTML, 3D, and Shaders, Unified.</span>
          <span>Made with Munari</span>
        </footer>
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
