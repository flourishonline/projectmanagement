import { describe, expect, it } from 'vitest'
import {
  addDays,
  brisbaneInstant,
  brisbaneTimeInput,
  brisbaneEndOfDay,
  brisbaneStartOfDay,
  dayOfMonthIn,
  daysBetween,
  daysInMonth,
  endOfWeek,
  formatBrisbaneTime,
  formatDisplayDate,
  formatShortDate,
  formatStopwatch,
  parseIsoDate,
  startOfWeek,
  toBrisbaneDate,
} from './dates'

describe('calendar arithmetic', () => {
  it('parses and validates ISO dates', () => {
    expect(parseIsoDate('2026-08-21')).toEqual({ year: 2026, month: 8, day: 21 })
    expect(() => parseIsoDate('21/08/2026')).toThrow(RangeError)
    expect(() => parseIsoDate('2026-02-30')).toThrow(RangeError)
    expect(() => parseIsoDate('2026-13-01')).toThrow(RangeError)
  })

  it('knows month lengths, leap years included', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 8)).toBe(31)
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('measures whole days between dates', () => {
    expect(daysBetween('2026-08-21', '2026-08-31')).toBe(10)
    expect(daysBetween('2026-08-31', '2026-08-21')).toBe(-10)
  })

  it('pulls a day-of-month back into short months', () => {
    expect(dayOfMonthIn(2026, 2, 31)).toBe('2026-02-28')
    expect(dayOfMonthIn(2028, 2, 31)).toBe('2028-02-29')
    expect(dayOfMonthIn(2026, 8, 15)).toBe('2026-08-15')
  })

  it('rolls month overflow into the next year', () => {
    expect(dayOfMonthIn(2026, 13, 1)).toBe('2027-01-01')
    expect(dayOfMonthIn(2026, 14, 31)).toBe('2027-02-28')
  })
})

describe('Brisbane time', () => {
  it('places an instant on the right Brisbane day', () => {
    // 21:30 UTC is already the next morning in Brisbane.
    expect(toBrisbaneDate(new Date('2026-08-20T21:30:00Z'))).toBe('2026-08-21')
    expect(toBrisbaneDate(new Date('2026-08-21T13:59:00Z'))).toBe('2026-08-21')
    expect(toBrisbaneDate(new Date('2026-08-21T14:00:00Z'))).toBe('2026-08-22')
  })

  it('bounds a Brisbane day as a half-open UTC interval', () => {
    expect(brisbaneStartOfDay('2026-08-21').toISOString()).toBe('2026-08-20T14:00:00.000Z')
    expect(brisbaneEndOfDay('2026-08-21').toISOString()).toBe('2026-08-21T14:00:00.000Z')
  })

  it('renders the wall clock in Brisbane, not UTC', () => {
    expect(formatBrisbaneTime(new Date('2026-08-20T23:05:00Z'))).toBe('9:05 am')
    expect(formatBrisbaneTime(new Date('2026-08-21T04:00:00Z'))).toBe('2:00 pm')
    expect(formatBrisbaneTime(new Date('2026-08-21T02:00:00Z'))).toBe('12:00 pm')
    expect(formatBrisbaneTime(new Date('2026-08-20T14:00:00Z'))).toBe('12:00 am')
  })
})

describe('wall-clock entry', () => {
  it('reads a Brisbane date and time as the right UTC instant', () => {
    expect(brisbaneInstant('2026-08-21', '09:00').toISOString()).toBe('2026-08-20T23:00:00.000Z')
    expect(brisbaneInstant('2026-08-21', '9:00').toISOString()).toBe('2026-08-20T23:00:00.000Z')
    expect(brisbaneInstant('2026-08-21', '00:00').toISOString()).toBe('2026-08-20T14:00:00.000Z')
  })

  it('rejects nonsense', () => {
    expect(() => brisbaneInstant('2026-08-21', '25:00')).toThrow(RangeError)
    expect(() => brisbaneInstant('2026-08-21', '9am')).toThrow(RangeError)
    expect(() => brisbaneInstant('not-a-date', '09:00')).toThrow(RangeError)
  })

  it('round-trips back to the same wall clock', () => {
    const instant = brisbaneInstant('2026-08-21', '14:35')
    expect(brisbaneTimeInput(instant)).toBe('14:35')
  })
})

describe('weeks start on Monday', () => {
  it('finds the Monday of the containing week', () => {
    expect(startOfWeek('2026-08-21')).toBe('2026-08-17') // a Friday
    expect(startOfWeek('2026-08-17')).toBe('2026-08-17') // the Monday itself
    expect(startOfWeek('2026-08-23')).toBe('2026-08-17') // the Sunday belongs to it
  })

  it('ends the week on Sunday', () => {
    expect(endOfWeek('2026-08-21')).toBe('2026-08-23')
  })
})

describe('display formats', () => {
  it('uses D MMM YYYY', () => {
    expect(formatDisplayDate('2026-08-21')).toBe('21 Aug 2026')
    expect(formatDisplayDate('2026-01-05')).toBe('5 Jan 2026')
  })

  it('labels grid columns with the weekday', () => {
    expect(formatShortDate('2026-08-21')).toBe('Fri 21 Aug')
  })

  it('renders the running timer as HH:MM:SS', () => {
    expect(formatStopwatch(0)).toBe('00:00:00')
    expect(formatStopwatch(3661)).toBe('01:01:01')
    expect(formatStopwatch(36_000)).toBe('10:00:00')
    expect(formatStopwatch(-5)).toBe('00:00:00')
  })
})
