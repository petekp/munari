// Postcard example — shared form state shown on the page or a moving mesh.
// The holder owns layout; the mesh follows its measured rectangle. Resizing
// scales the holder rather than the captured root, whose layout stays 420×270.
// Motion returns to an exact flat pose before requesting the page presentation.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  Surface,
  type SurfaceHandle,
  useSurfaceStatus,
} from '@petepetrash/munari'
import { readSurfaceFrameState } from '@petepetrash/munari/advanced'
import type { HomeFlyerStore } from './homeFlyer'

import { PAPER_WIDTH, PAPER_HEIGHT, type PaperInteraction } from './homePaperLaw'

export const HERO_W = PAPER_WIDTH
export const HERO_H = PAPER_HEIGHT

export type HolderRef = React.RefObject<HTMLDivElement | null>
export type LandRef = { current: boolean }

// Postmark spots as card percentages. Deterministic, so the DOM copy and
// the captured copy always agree; clicks past the table revisit spots
// with a small extra rotation instead of stacking pixel-identical marks.
const MARK_SPOTS = [
  { x: 6, y: 52, rot: -12 },
  { x: 58, y: 4, rot: 8 },
  { x: 32, y: 60, rot: -5 },
  { x: 72, y: 54, rot: 14 },
  { x: 20, y: 6, rot: 5 },
  { x: 46, y: 30, rot: -16 },
  { x: 78, y: 20, rot: -8 },
]

function Postcard({
  name,
  onName,
  stamps,
  onStamp,
}: {
  name: string
  onName: (v: string) => void
  stamps: number
  onStamp: () => void
}) {
  const inputId = useId()
  const marks = []
  for (let k = Math.max(0, stamps - MARK_SPOTS.length); k < stamps; k++) {
    const s = MARK_SPOTS[k % MARK_SPOTS.length]
    marks.push(
      <span
        key={k}
        className="home-postmark"
        aria-hidden
        style={{
          left: `${s.x}%`,
          top: `${s.y}%`,
          rotate: `${s.rot + Math.floor(k / MARK_SPOTS.length) * 9}deg`,
        }}
      >
        par avion
      </span>,
    )
  }
  return (
    <div className="home-postcard">
      <div className="home-postcard-msg grid min-w-0 content-start gap-2 text-left">
        <h3>Ciao.</h3>
        <p>
          A little HTML, away from the page. Add your name and a stamp.
        </p>
        <button type="button" className="mt-[6px] min-h-11 cursor-pointer justify-self-start border-0 bg-[var(--ground)] px-[14px] py-0 font-[550] text-[14px] text-[var(--paper)] hover:bg-[#38383f] active:bg-black active:text-[var(--chartreuse)] focus-visible:outline-[3px] focus-visible:outline-[#ba3829] focus-visible:outline-offset-3" onClick={onStamp}>
          Add a stamp
        </button>
      </div>
      <div className="home-postcard-addr">
        <span className="home-postcard-stamp" aria-hidden>
          ✈
        </span>
        <label htmlFor={inputId}>To</label>
        <input
          id={inputId}
          value={name}
          placeholder="Your name"
          autoComplete="off"
          onChange={(e) => onName(e.target.value)}
        />
        <p className="home-postcard-line">
          {name ? `For ${name}, with love.` : 'Greetings from the web.'}
        </p>
      </div>
      {marks}
    </div>
  )
}

function PostcardInstructions({ supported, lifted, reduced }: { supported: boolean; lifted: boolean; reduced: boolean }) {
  let text = 'Add your name, then lift the postcard.'
  if (!supported) text = 'The form works here. Play the 3D preview.'
  else if (reduced) text = 'Motion is reduced. Switch between page and scene.'
  else if (lifted) text = 'Brush a corner or add a stamp. Keep typing.'
  return <p className="home-note">{text}</p>
}

function PostcardPresentation({surface,preview}:{surface:SurfaceHandle;preview:boolean}) {
  const state = useSurfaceStatus(surface)
  return <span className="home-postcard-status" data-gl={state.presentation === 'scene'} aria-live="polite">
    {preview ? 'Recorded in Chrome' : state.presentation === 'scene' ? 'In the scene' : 'On the page'}
  </span>
}

export function HeroSection({
  flyer,
  canvasId,
  surface,
  paper,
  inScene,
  setInScene,
  holderRef,
  landRef,
  supported,
  reduced,
}: {
  flyer: HomeFlyerStore
  canvasId: string
  surface: SurfaceHandle
  paper: PaperInteraction
  inScene: boolean
  setInScene: React.Dispatch<React.SetStateAction<boolean>>
  holderRef: HolderRef
  landRef: LandRef
  supported: boolean
  reduced: boolean
}) {
  const [name, setName] = useState('')
  const [stamps, setStamps] = useState(0)
  const [preview, setPreview] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const lifted = inScene
  // The card's shadow is the flyer's in both worlds (homeFlyer.ts). On the
  // page the holder is named in the same commit that shows it; in the scene
  // the mesh publishes its corners per frame.
  useLayoutEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    flyer.set({ kind: 'page', element: holder })
  }, [holderRef, flyer])
  useEffect(() => () => flyer.set(null), [flyer])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => setScale(Math.min(1, viewport.clientWidth / HERO_W))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const content = (
    <Postcard
      name={name}
      onName={setName}
      stamps={stamps}
      onStamp={() => {
        setStamps(n => n+1)
        if (readSurfaceFrameState(surface).presentation==='scene') paper.impulses++
      }}
    />
  )
  return (
    <section className="home-hero min-w-0" id="try" aria-label="A live postcard under the light">
      <div className="home-hero-stage w-full min-w-0 max-w-[420px]" data-live={supported}>
        <div ref={viewportRef} className="home-hero-viewport relative aspect-[420/270] w-full">
          <div ref={holderRef} className="home-hero-holder" style={{ transform: `scale(${scale})` }} hidden={preview}>
            {supported ? (
              <Surface.Root surface={surface} canvasId={canvasId} onPresentationChange={presentation => {
                if (presentation === 'page' && holderRef.current) flyer.set({kind:'page',element:holderRef.current})
              }} timing={{ settleMs: reduced ? 0 : 120, durationMs: reduced ? 0 : 260 }} inScene={inScene}>
                <Surface.HTML size={[HERO_W, HERO_H]}>{content}</Surface.HTML>
              </Surface.Root>
            ) : content}
          </div>
          {preview && (
            <video
              className="home-hero-preview"
              src="/previews/postcard.mp4"
              poster="/previews/postcard.jpg"
              controls
              playsInline
              autoPlay
              muted
              aria-label="Recorded preview of the postcard moving into 3D and returning to the page"
            />
          )}
        </div>
        <div className="home-hero-row mt-6 flex items-center justify-between gap-3 @max-[600px]/demo:mt-[18px] @max-[600px]/demo:gap-2">
          {supported ? (
            <button
              type="button"
              className="home-btn"
              data-relief="raised"
              onClick={() => {
                if (!lifted) setInScene(true)
                else if (reduced) setInScene(false)
                else landRef.current = true
              }}
            >
              {lifted ? 'Return to page' : 'Lift the postcard'}
            </button>
          ) : (
            <button type="button" className="home-btn" data-relief="raised" onClick={() => setPreview((value) => !value)}>
              {preview ? 'Back to the postcard' : 'Play 3D preview'}
            </button>
          )}
          <PostcardPresentation surface={surface} preview={preview} />
        </div>
        <PostcardInstructions supported={supported} lifted={lifted} reduced={reduced} />
      </div>
    </section>
  )
}
