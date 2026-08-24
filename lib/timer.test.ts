import { describe, expect, it } from 'vitest'
import { isRunawayTimer, RUNAWAY_TIMER_SECONDS, safeEndTime } from './timer'

describe('stopping a timer', () => {
  it('records the actual elapsed time', () => {
    const started = '2026-08-21T09:00:00.000Z'
    const now = new Date('2026-08-21T10:30:00.000Z')
    expect(safeEndTime(started, now)).toBe('2026-08-21T10:30:00.000Z')
  })

  it('never produces an end that is not after the start', () => {
    // Start and stop in the same instant: one second is recorded rather than
    // the database rejecting the update and the entry being lost.
    const started = '2026-08-21T09:00:00.000Z'
    const now = new Date('2026-08-21T09:00:00.000Z')
    expect(safeEndTime(started, now)).toBe('2026-08-21T09:00:01.000Z')
  })

  it('is robust to a clock that has drifted backwards', () => {
    const started = '2026-08-21T09:00:00.000Z'
    const now = new Date('2026-08-21T08:59:00.000Z')
    expect(safeEndTime(started, now)).toBe('2026-08-21T09:00:01.000Z')
  })
})

describe('runaway timers', () => {
  const started = '2026-08-21T00:00:00.000Z'

  it('leaves a normal working day alone', () => {
    expect(isRunawayTimer(started, new Date('2026-08-21T07:59:00.000Z'))).toBe(false)
  })

  it('flags anything past ten hours', () => {
    expect(isRunawayTimer(started, new Date('2026-08-21T10:00:01.000Z'))).toBe(true)
  })

  it('uses the threshold from the brief', () => {
    expect(RUNAWAY_TIMER_SECONDS).toBe(36_000)
  })
})
