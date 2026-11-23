// Planner sheet — one day's page of the pad as ordinary HTML: the printed
// date and almanac, and a ruled list of real checkboxes and text fields.
// Both live pages render this component with the same layout, so a task
// carried to tomorrow sits on the same ruled line as it did today.
import { PAD_CITY, type Sheet } from './tearPlannerAlmanac'
import type { Slots } from './tearPlannerTasks'

export const SHEET_WIDTH = 420
export const SHEET_HEIGHT = 594

export function TearPlannerPage({
  sheet,
  slots,
  carriedCount,
  onText,
  onToggle,
}: {
  readonly sheet: Sheet
  readonly slots: Slots
  readonly carriedCount: number
  readonly onText: (slot: number, text: string) => void
  readonly onToggle: (slot: number) => void
}) {
  return (
    <article className="tp-sheet" data-sunday={sheet.isSunday || undefined} style={{ width: SHEET_WIDTH, height: SHEET_HEIGHT }}>
      <header className="tp-sheet-head">
        <span>{sheet.month} {sheet.year}</span>
        <span>Week {sheet.week}</span>
      </header>
      <div className="tp-date">
        <span className="tp-numeral">{sheet.day}</span>
        <span className="tp-weekday">{sheet.weekday}</span>
      </div>
      <dl className="tp-almanac">
        <div><dt>Sunrise</dt><dd>{sheet.sunrise}</dd></div>
        <div><dt>Sunset</dt><dd>{sheet.sunset}</dd></div>
        <div><dt>Daylight</dt><dd>{sheet.daylight}</dd></div>
        <div><dt>Moon</dt><dd>{sheet.moon}</dd></div>
      </dl>
      <p className="tp-yearline">Day {sheet.dayOfYear} of {sheet.year} · {sheet.daysLeft} to go</p>
      <section className="tp-list" aria-label={`To do on ${sheet.weekday} ${sheet.day} ${sheet.month}`}>
        <h2 className="tp-list-title">
          <span>To do</span>
          {carriedCount > 0 && <span className="tp-list-carried">{carriedCount} carried over</span>}
        </h2>
        <ol className="tp-rows">
          {slots.map((task, slot) => {
            const hasText = task !== null && task.text.trim() !== ''
            const label = `${sheet.weekday}, line ${slot + 1}`
            return (
              <li key={slot} className="tp-row" data-done={task?.done || undefined}>
                <input
                  type="checkbox"
                  className="tp-check"
                  aria-label={hasText ? `Done: ${task.text}` : `${label}: nothing to tick`}
                  checked={task?.done ?? false}
                  disabled={!hasText}
                  onChange={() => onToggle(slot)}
                />
                <input
                  type="text"
                  className="tp-task"
                  aria-label={label}
                  value={task?.text ?? ''}
                  spellCheck={false}
                  onChange={(event) => onText(slot, event.target.value)}
                />
                {task?.carriedFrom && <span className="tp-from">from {task.carriedFrom.slice(0, 3)}</span>}
              </li>
            )
          })}
        </ol>
      </section>
      <footer className="tp-sheet-foot">
        <span>{sheet.weekday.slice(0, 3)} {sheet.day}</span>
        <span>{PAD_CITY.name} · {PAD_CITY.latitudeLabel}</span>
      </footer>
      <div className="tp-grip" data-tp-grip="" aria-hidden="true" />
    </article>
  )
}
