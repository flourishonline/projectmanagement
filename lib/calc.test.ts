import { describe, expect, it } from 'vitest'
import {
  burnState,
  calculateBundleBurn,
  calculateRetainerBurn,
  calculateRollover,
  calculateStandaloneBurn,
  compareByUrgency,
  daysRemainingInPeriod,
  findPeriodFor,
  formatAud,
  formatHours,
  formatHoursLabel,
  generateRetainerPeriods,
  hoursToSeconds,
  percentUsed,
  secondsToHours,
  sumDurationSeconds,
  type BurnState,
} from './calc'

const hrs = hoursToSeconds

describe('units and formatting', () => {
  it('converts between seconds and hours without losing precision', () => {
    expect(secondsToHours(3600)).toBe(1)
    expect(secondsToHours(11_700)).toBe(3.25)
    expect(hoursToSeconds(3.25)).toBe(11_700)
  })

  it('displays hours to exactly two places', () => {
    expect(formatHours(3.25)).toBe('3.25')
    expect(formatHours(3)).toBe('3.00')
    expect(formatHours(0.005)).toBe('0.01')
    expect(formatHoursLabel(12.5)).toBe('12.50 hrs')
  })

  it('shows overdrawn hours as negative rather than dressing them up', () => {
    expect(formatHours(-1.5)).toBe('-1.50')
  })

  it('never renders a negative zero', () => {
    expect(formatHours(-0.0001)).toBe('0.00')
  })

  it('formats money in Australian dollars', () => {
    expect(formatAud(4500)).toBe('$4,500.00')
    expect(formatAud(185.5)).toBe('$185.50')
  })

  it('sums durations and ignores entries still running', () => {
    expect(
      sumDurationSeconds([
        { duration_seconds: 3600 },
        { duration_seconds: 1800 },
        { duration_seconds: null },
      ]),
    ).toBe(5400)
  })
})

describe('burn state thresholds', () => {
  it('follows the brief’s bands', () => {
    expect(burnState(0)).toBe('healthy')
    expect(burnState(74.99)).toBe('healthy')
    expect(burnState(75)).toBe('warning')
    expect(burnState(90)).toBe('warning')
    expect(burnState(90.01)).toBe('critical')
    expect(burnState(100)).toBe('critical')
    expect(burnState(100.01)).toBe('overdrawn')
  })

  it('treats a fully spent budget as critical, not yet overdrawn', () => {
    const burn = calculateRetainerBurn({ allocatedHours: 10, rolledInHours: 0, usedSeconds: hrs(10) })
    expect(burn.remainingHours).toBe(0)
    expect(burn.state).toBe('critical')
  })

  it('handles a budget of zero without dividing by it', () => {
    expect(percentUsed(0, 0)).toBe(0)
    expect(percentUsed(1, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(burnState(percentUsed(1, 0))).toBe('overdrawn')
  })

  it('sorts the projects in trouble to the top', () => {
    const cards: Array<{ name: string; state: BurnState; percentUsed: number }> = [
      { name: 'calm', state: 'healthy', percentUsed: 20 },
      { name: 'over', state: 'overdrawn', percentUsed: 130 },
      { name: 'nearly', state: 'critical', percentUsed: 95 },
      { name: 'watch', state: 'warning', percentUsed: 80 },
      { name: 'worse', state: 'overdrawn', percentUsed: 210 },
    ]
    expect([...cards].sort(compareByUrgency).map((c) => c.name)).toEqual([
      'worse',
      'over',
      'nearly',
      'watch',
      'calm',
    ])
  })
})

describe('retainer burn', () => {
  it('is scoped to the current period', () => {
    const burn = calculateRetainerBurn({
      allocatedHours: 20,
      rolledInHours: 0,
      usedSeconds: hrs(12.5),
    })
    expect(burn.availableHours).toBe(20)
    expect(burn.usedHours).toBe(12.5)
    expect(burn.remainingHours).toBe(7.5)
    expect(burn.percentUsed).toBeCloseTo(62.5)
    expect(burn.state).toBe('healthy')
  })

  it('counts rolled-in hours as available', () => {
    const burn = calculateRetainerBurn({
      allocatedHours: 20,
      rolledInHours: 6,
      usedSeconds: hrs(22),
    })
    expect(burn.availableHours).toBe(26)
    expect(burn.remainingHours).toBe(4)
    expect(burn.state).toBe('warning')
  })

  it('reports a negative balance once the period is overdrawn', () => {
    const burn = calculateRetainerBurn({
      allocatedHours: 20,
      rolledInHours: 0,
      usedSeconds: hrs(23.5),
    })
    expect(burn.remainingHours).toBe(-3.5)
    expect(burn.state).toBe('overdrawn')
    expect(formatHoursLabel(burn.remainingHours)).toBe('-3.50 hrs')
  })

  it('handles a first period with nothing rolled in', () => {
    const burn = calculateRetainerBurn({
      allocatedHours: 15,
      rolledInHours: 0,
      usedSeconds: 0,
    })
    expect(burn.availableHours).toBe(15)
    expect(burn.remainingHours).toBe(15)
    expect(burn.percentUsed).toBe(0)
    expect(burn.state).toBe('healthy')
  })
})

describe('rollover at period close', () => {
  const base = { allocatedHours: 20, rolledInHours: 0, rolloverCapHours: null }

  it('forfeits unused hours when rollover is off', () => {
    expect(
      calculateRollover({ ...base, rolloverEnabled: false, usedSeconds: hrs(5) }),
    ).toBe(0)
  })

  it('carries unused hours forward when rollover is on and uncapped', () => {
    expect(
      calculateRollover({ ...base, rolloverEnabled: true, usedSeconds: hrs(5) }),
    ).toBe(15)
  })

  it('clips the carry-over at the cap', () => {
    expect(
      calculateRollover({
        ...base,
        rolloverEnabled: true,
        rolloverCapHours: 8,
        usedSeconds: hrs(2),
      }),
    ).toBe(8)
  })

  it('carries the true figure when it sits under the cap', () => {
    expect(
      calculateRollover({
        ...base,
        rolloverEnabled: true,
        rolloverCapHours: 8,
        usedSeconds: hrs(14),
      }),
    ).toBe(6)
  })

  it('carries nothing out of an overdrawn period — an overrun is absorbed, not passed on', () => {
    expect(
      calculateRollover({ ...base, rolloverEnabled: true, usedSeconds: hrs(26) }),
    ).toBe(0)
  })

  it('includes hours rolled in from the period before when working out what rolls on', () => {
    expect(
      calculateRollover({
        allocatedHours: 20,
        rolledInHours: 5,
        rolloverEnabled: true,
        rolloverCapHours: null,
        usedSeconds: hrs(18),
      }),
    ).toBe(7)
  })

  it('treats a cap of zero as no rollover at all', () => {
    expect(
      calculateRollover({
        ...base,
        rolloverEnabled: true,
        rolloverCapHours: 0,
        usedSeconds: hrs(1),
      }),
    ).toBe(0)
  })
})

describe('retainer period generation', () => {
  it('runs billing day to billing day when the retainer starts on one', () => {
    const periods = generateRetainerPeriods({
      startDate: '2026-06-01',
      billingDayOfMonth: 1,
      upTo: '2026-08-21',
    })
    expect(periods).toEqual([
      { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      { periodStart: '2026-07-01', periodEnd: '2026-07-31' },
      { periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    ])
  })

  it('gives a retainer that starts mid-cycle a short first period', () => {
    const periods = generateRetainerPeriods({
      startDate: '2026-06-10',
      billingDayOfMonth: 1,
      upTo: '2026-08-05',
    })
    expect(periods).toEqual([
      { periodStart: '2026-06-10', periodEnd: '2026-06-30' },
      { periodStart: '2026-07-01', periodEnd: '2026-07-31' },
      { periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    ])
  })

  it('pulls a billing day of 31 back to the end of shorter months, then restores it', () => {
    const periods = generateRetainerPeriods({
      startDate: '2026-01-31',
      billingDayOfMonth: 31,
      upTo: '2026-04-30',
    })
    expect(periods).toEqual([
      { periodStart: '2026-01-31', periodEnd: '2026-02-27' },
      { periodStart: '2026-02-28', periodEnd: '2026-03-30' },
      { periodStart: '2026-03-31', periodEnd: '2026-04-29' },
      { periodStart: '2026-04-30', periodEnd: '2026-05-30' },
    ])
  })

  it('reaches 29 February in a leap year', () => {
    const periods = generateRetainerPeriods({
      startDate: '2028-01-31',
      billingDayOfMonth: 31,
      upTo: '2028-03-01',
    })
    expect(periods[1]).toEqual({ periodStart: '2028-02-29', periodEnd: '2028-03-30' })
  })

  it('stops at the retainer’s end date and trims the final period to it', () => {
    const periods = generateRetainerPeriods({
      startDate: '2026-06-01',
      billingDayOfMonth: 1,
      upTo: '2026-12-31',
      endDate: '2026-08-15',
    })
    expect(periods).toEqual([
      { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      { periodStart: '2026-07-01', periodEnd: '2026-07-31' },
      { periodStart: '2026-08-01', periodEnd: '2026-08-15' },
    ])
  })

  it('generates nothing for a retainer that has not started yet', () => {
    expect(
      generateRetainerPeriods({
        startDate: '2026-09-01',
        billingDayOfMonth: 1,
        upTo: '2026-08-21',
      }),
    ).toEqual([])
  })

  it('generates nothing when the end date precedes the start date', () => {
    expect(
      generateRetainerPeriods({
        startDate: '2026-09-01',
        billingDayOfMonth: 1,
        upTo: '2026-12-01',
        endDate: '2026-08-01',
      }),
    ).toEqual([])
  })

  it('rejects an impossible billing day', () => {
    expect(() =>
      generateRetainerPeriods({ startDate: '2026-06-01', billingDayOfMonth: 0, upTo: '2026-07-01' }),
    ).toThrow(RangeError)
  })

  it('leaves no gap or overlap between consecutive periods', () => {
    const periods = generateRetainerPeriods({
      startDate: '2025-03-15',
      billingDayOfMonth: 29,
      upTo: '2026-08-21',
    })
    expect(periods.length).toBeGreaterThan(12)
    for (let i = 1; i < periods.length; i += 1) {
      const previousEnd = new Date(`${periods[i - 1]!.periodEnd}T00:00:00Z`).getTime()
      const thisStart = new Date(`${periods[i]!.periodStart}T00:00:00Z`).getTime()
      expect(thisStart - previousEnd).toBe(86_400_000)
    }
  })

  it('finds the period a given day falls in', () => {
    const periods = generateRetainerPeriods({
      startDate: '2026-06-01',
      billingDayOfMonth: 1,
      upTo: '2026-08-21',
    })
    expect(findPeriodFor(periods, '2026-07-15')?.periodStart).toBe('2026-07-01')
    expect(findPeriodFor(periods, '2026-05-30')).toBeNull()
  })

  it('counts days remaining, with zero meaning it ends today', () => {
    expect(daysRemainingInPeriod('2026-08-31', '2026-08-21')).toBe(10)
    expect(daysRemainingInPeriod('2026-08-21', '2026-08-21')).toBe(0)
    expect(daysRemainingInPeriod('2026-08-20', '2026-08-21')).toBe(-1)
  })
})

describe('bundle burn', () => {
  it('measures a single purchase across all time', () => {
    const burn = calculateBundleBurn(
      [{ purchasedHours: 40, purchaseDate: '2026-05-01' }],
      hrs(12),
    )
    expect(burn.purchasedHours).toBe(40)
    expect(burn.remainingHours).toBe(28)
    expect(burn.percentUsed).toBe(30)
    expect(burn.state).toBe('healthy')
    expect(burn.topUpDue).toBe(false)
  })

  it('adds a mid-month top-up to the same pot', () => {
    const burn = calculateBundleBurn(
      [
        { purchasedHours: 20, purchaseDate: '2026-07-01' },
        { purchasedHours: 20, purchaseDate: '2026-08-14' },
      ],
      hrs(24),
    )
    expect(burn.purchasedHours).toBe(40)
    expect(burn.remainingHours).toBe(16)
    expect(burn.percentUsed).toBe(60)
  })

  it('goes negative rather than stopping at zero when overdrawn', () => {
    const burn = calculateBundleBurn(
      [{ purchasedHours: 10, purchaseDate: '2026-05-01' }],
      hrs(13.75),
    )
    expect(burn.remainingHours).toBe(-3.75)
    expect(burn.percentUsed).toBe(137.5)
    expect(burn.state).toBe('overdrawn')
  })

  it('flags a top-up conversation once the threshold is crossed', () => {
    const burn = calculateBundleBurn(
      [{ purchasedHours: 40, purchaseDate: '2026-05-01' }],
      hrs(30),
    )
    expect(burn.percentUsed).toBe(75)
    expect(burn.topUpDue).toBe(true)
  })

  it('takes the threshold from the most recent purchase, not the first', () => {
    const burn = calculateBundleBurn(
      [
        { purchasedHours: 20, purchaseDate: '2026-07-01', lowBalanceThresholdPct: 75 },
        { purchasedHours: 20, purchaseDate: '2026-08-14', lowBalanceThresholdPct: 90 },
      ],
      hrs(32),
    )
    expect(burn.thresholdPct).toBe(90)
    expect(burn.percentUsed).toBe(80)
    expect(burn.topUpDue).toBe(false)
  })

  it('defaults the threshold to 75 per cent', () => {
    const burn = calculateBundleBurn([{ purchasedHours: 10, purchaseDate: '2026-05-01' }], 0)
    expect(burn.thresholdPct).toBe(75)
  })

  it('does not call for a top-up on a bundle with nothing purchased', () => {
    const burn = calculateBundleBurn([], 0)
    expect(burn.purchasedHours).toBe(0)
    expect(burn.topUpDue).toBe(false)
    expect(burn.state).toBe('healthy')
  })
})

describe('standalone projects', () => {
  it('reports variance rather than a balance', () => {
    const burn = calculateStandaloneBurn({
      quotedHours: 30,
      fixedFee: 6000,
      usedSeconds: hrs(24),
    })
    expect(burn.actualHours).toBe(24)
    expect(burn.varianceHours).toBe(6)
    expect(burn.effectiveHourlyRate).toBe(250)
    // 24 of 30 quoted hours is 80% — worth a look, not yet a problem.
    expect(burn.state).toBe('warning')
  })

  it('turns variance negative once the job runs past its quote', () => {
    const burn = calculateStandaloneBurn({
      quotedHours: 30,
      fixedFee: 6000,
      usedSeconds: hrs(45),
    })
    expect(burn.varianceHours).toBe(-15)
    expect(burn.state).toBe('overdrawn')
    expect(burn.effectiveHourlyRate).toBeCloseTo(133.33, 2)
  })

  it('has no effective rate before any time is logged', () => {
    const burn = calculateStandaloneBurn({ quotedHours: 30, fixedFee: 6000, usedSeconds: 0 })
    expect(burn.effectiveHourlyRate).toBeNull()
    expect(burn.varianceHours).toBe(30)
  })

  it('handles a fee of zero, which is internal work rather than a margin problem', () => {
    const burn = calculateStandaloneBurn({ quotedHours: 10, fixedFee: 0, usedSeconds: hrs(4) })
    expect(burn.effectiveHourlyRate).toBe(0)
  })
})
