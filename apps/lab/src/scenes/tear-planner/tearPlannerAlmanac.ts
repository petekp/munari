// Planner almanac — the printed facts on each day's sheet: date, ISO week,
// day of the year, sunrise and sunset, and the moon.
//
// Sun times use NOAA's solar position equations (the "General Solar Position
// Calculations" sheet) for the pad's printed city, with the standard -0.833°
// altitude for refraction and the solar disc; they agree with the NOAA
// calculator to about a minute at this latitude. Moon age counts synodic
// months of 29.530588853 days from the new moon of 2000-01-06 18:14 UTC.

export const PAD_CITY = { name: 'Edinburgh', latitude: 55.9533, longitude: -3.1883, latitudeLabel: '55°57′ N', utcOffsetHours: 0 } as const

/** The first sheet on the pad. */
export const FIRST_DAY = Date.UTC(2026, 10, 23)

const DAY_MS = 86_400_000
const SYNODIC_DAYS = 29.530588853
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

export interface Sheet {
  readonly time: number
  readonly day: number
  readonly weekday: string
  readonly month: string
  readonly year: number
  readonly isSunday: boolean
  readonly week: number
  readonly dayOfYear: number
  readonly daysLeft: number
  readonly sunrise: string
  readonly sunset: string
  readonly daylight: string
  readonly moon: string
}

export function sheetFor(offset: number): Sheet {
  const time = FIRST_DAY + offset * DAY_MS
  const date = new Date(time)
  const year = date.getUTCFullYear()
  const dayOfYear = Math.round((time - Date.UTC(year, 0, 1)) / DAY_MS) + 1
  const yearLength = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS)
  const sun = sunTimes(time)
  return {
    time,
    day: date.getUTCDate(),
    weekday: WEEKDAYS[date.getUTCDay()],
    month: MONTHS[date.getUTCMonth()],
    year,
    isSunday: date.getUTCDay() === 0,
    week: isoWeek(time),
    dayOfYear,
    daysLeft: yearLength - dayOfYear,
    sunrise: clock(sun.rise),
    sunset: clock(sun.set),
    daylight: duration(sun.set - sun.rise),
    moon: moonPhase(time + 12 * 3_600_000),
  }
}

export function weekdayShort(offset: number): string {
  return sheetFor(offset).weekday.slice(0, 3)
}

function isoWeek(time: number): number {
  const date = new Date(time)
  const weekday = (date.getUTCDay() + 6) % 7
  const thursday = time + (3 - weekday) * DAY_MS
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1)
  return 1 + Math.floor((thursday - yearStart) / (7 * DAY_MS))
}

/** Sunrise and sunset as minutes after local midnight. */
function sunTimes(time: number) {
  const rad = Math.PI / 180
  const date = new Date(time)
  const dayOfYear = Math.round((time - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS) + 1
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma))
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma)
  const lat = PAD_CITY.latitude * rad
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)
  const ha = Math.acos(Math.max(-1, Math.min(1, cosHa))) / rad
  const noon = 720 - 4 * PAD_CITY.longitude - eqTime + PAD_CITY.utcOffsetHours * 60
  return { rise: noon - 4 * ha, set: noon + 4 * ha }
}

function clock(minutes: number): string {
  const m = Math.round(minutes)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function duration(minutes: number): string {
  const m = Math.round(minutes)
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

function moonPhase(time: number): string {
  const age = (((time - NEW_MOON_EPOCH) / DAY_MS) % SYNODIC_DAYS + SYNODIC_DAYS) % SYNODIC_DAYS
  if (age < 1.85) return 'New moon'
  if (age < 5.54) return 'Waxing crescent'
  if (age < 9.23) return 'First quarter'
  if (age < 12.92) return 'Waxing gibbous'
  if (age < 16.61) return 'Full moon'
  if (age < 20.3) return 'Waning gibbous'
  if (age < 23.99) return 'Last quarter'
  if (age < 27.68) return 'Waning crescent'
  return 'New moon'
}
