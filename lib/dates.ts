/**
 * Date handling for Flourish Ops.
 *
 * Everything is stored UTC and displayed in Brisbane time. Queensland does not
 * observe daylight saving, so Brisbane is a fixed UTC+10 all year — which is
 * why plain offset arithmetic is safe here and would not be anywhere else.
 *
 * Calendar dates (period boundaries, due dates, billing days) are handled as
 * `YYYY-MM-DD` strings and never as `Date` objects, so no local timezone can
 * shunt a date across a day boundary on its way through the app.
 */

export const BRISBANE_TIME_ZONE = 'Australia/Brisbane'
export const BRISBANE_UTC_OFFSET = '+10:00'
export const SECONDS_PER_HOUR = 3600

/** A calendar date with no time and no zone. `month` is 1-12. */
export interface CalendarDate {
  year: number
  month: number
  day: number
}

/** `YYYY-MM-DD`. */
export type IsoDate = string

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseIsoDate(value: IsoDate): CalendarDate {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${value}"`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`"${value}" is not a real calendar date`)
  }
  return { year, month, day }
}

export function formatIsoDate(date: CalendarDate): IsoDate {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return formatIsoDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  const msPerDay = 86_400_000
  const start = Date.UTC(a.year, a.month - 1, a.day)
  const end = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((end - start) / msPerDay)
}

/**
 * The given day-of-month within a specific month, pulled back to the last day
 * of that month when it does not exist — a retainer billed on the 31st rolls
 * over on 28 February.
 */
export function dayOfMonthIn(year: number, month: number, dayOfMonth: number): IsoDate {
  const normalisedYear = year + Math.floor((month - 1) / 12)
  const normalisedMonth = ((month - 1) % 12 + 12) % 12 + 1
  const day = Math.min(dayOfMonth, daysInMonth(normalisedYear, normalisedMonth))
  return formatIsoDate({ year: normalisedYear, month: normalisedMonth, day })
}

// ---------------------------------------------------------------------------
// Brisbane wall-clock conversions
// ---------------------------------------------------------------------------

/** The Brisbane calendar date on which a given instant falls. */
export function toBrisbaneDate(instant: Date): IsoDate {
  const shifted = new Date(instant.getTime() + 10 * 60 * 60 * 1000)
  return formatIsoDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

/** Midnight at the start of a Brisbane calendar date, as a UTC instant. */
export function brisbaneStartOfDay(date: IsoDate): Date {
  return new Date(`${date}T00:00:00${BRISBANE_UTC_OFFSET}`)
}

/** Midnight at the start of the *following* day — the exclusive upper bound. */
export function brisbaneEndOfDay(date: IsoDate): Date {
  return brisbaneStartOfDay(addDays(date, 1))
}

/** Monday of the Brisbane week containing `date`. Weeks start Monday. */
export function startOfWeek(date: IsoDate): IsoDate {
  const { year, month, day } = parseIsoDate(date)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday
  return addDays(date, offsetToMonday)
}

export function endOfWeek(date: IsoDate): IsoDate {
  return addDays(startOfWeek(date), 6)
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/

/** A Brisbane wall-clock date and `HH:MM` time, as a UTC instant. */
export function brisbaneInstant(date: IsoDate, time: string): Date {
  const match = TIME_PATTERN.exec(time.trim())
  if (!match) throw new RangeError(`Expected a HH:MM time, received "${time}"`)

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new RangeError(`"${time}" is not a real time of day`)

  parseIsoDate(date) // validates the date half
  const hh = String(hours).padStart(2, '0')
  return new Date(`${date}T${hh}:${match[2]}:00${BRISBANE_UTC_OFFSET}`)
}

/** `HH:MM` in Brisbane, for prefilling a time input. */
export function brisbaneTimeInput(instant: Date): string {
  const shifted = new Date(instant.getTime() + 10 * 60 * 60 * 1000)
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** `21 Aug 2026` — the house date format. */
export function formatDisplayDate(date: IsoDate): string {
  const { year, month, day } = parseIsoDate(date)
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`
}

/** `Fri 21 Aug` — for column headers in the weekly grid. */
export function formatShortDate(date: IsoDate): string {
  const { year, month, day } = parseIsoDate(date)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${WEEKDAY_NAMES[weekday]} ${day} ${MONTH_NAMES[month - 1]}`
}

/** `9:05 am` in Brisbane time. */
export function formatBrisbaneTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + 10 * 60 * 60 * 1000)
  const hours24 = shifted.getUTCHours()
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0')
  const suffix = hours24 < 12 ? 'am' : 'pm'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${minutes} ${suffix}`
}

/** `HH:MM:SS`, for the running timer. */
export function formatStopwatch(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}
