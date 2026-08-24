/**
 * Every hours and money calculation in Flourish Ops lives here.
 *
 * Nothing in this file touches the database or React. It takes plain numbers
 * in and gives plain numbers out, so the answer to "how many hours are left?"
 * can be tested exhaustively without standing anything up.
 *
 * Durations arrive in whole seconds, exactly as stored. Rounding happens only
 * at the moment of display.
 */

import {
  addDays,
  compareIsoDates,
  dayOfMonthIn,
  daysBetween,
  parseIsoDate,
  SECONDS_PER_HOUR,
  type IsoDate,
} from './dates'

export type ProjectType = 'retainer' | 'bundle' | 'standalone'

/**
 * How a project is travelling against its budget.
 *
 *   healthy    under 75% used
 *   warning    75% to 90%
 *   critical   over 90%, still within budget
 *   overdrawn  past 100% — the hours are gone
 */
export type BurnState = 'healthy' | 'warning' | 'critical' | 'overdrawn'

const BURN_STATE_ORDER: Record<BurnState, number> = {
  overdrawn: 0,
  critical: 1,
  warning: 2,
  healthy: 3,
}

// ---------------------------------------------------------------------------
// Units and formatting
// ---------------------------------------------------------------------------

export function secondsToHours(seconds: number): number {
  return seconds / SECONDS_PER_HOUR
}

export function hoursToSeconds(hours: number): number {
  return Math.round(hours * SECONDS_PER_HOUR)
}

/** Round for display only. Never write the result back to the database. */
export function roundHours(hours: number): number {
  return Math.round((hours + Number.EPSILON) * 100) / 100
}

/** `3.25` — two decimal places, always. */
export function formatHours(hours: number): string {
  const rounded = roundHours(hours)
  // Avoid rendering "-0.00" when a value rounds to zero from below.
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2)
}

/** `3.25 hrs` — the house unit. */
export function formatHoursLabel(hours: number): string {
  return `${formatHours(hours)} hrs`
}

export function formatDurationHours(seconds: number): string {
  return formatHours(secondsToHours(seconds))
}

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatAud(amount: number): string {
  return AUD.format(amount)
}

export function sumDurationSeconds(entries: ReadonlyArray<{ duration_seconds: number | null }>): number {
  return entries.reduce((total, entry) => total + (entry.duration_seconds ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Burn state
// ---------------------------------------------------------------------------

/**
 * Share of the budget consumed, as a percentage. Can exceed 100.
 *
 * A budget of zero is a special case: any time at all against it is fully
 * overdrawn, and no time at all is untouched rather than infinite.
 */
export function percentUsed(usedHours: number, availableHours: number): number {
  if (availableHours <= 0) {
    return usedHours > 0 ? Number.POSITIVE_INFINITY : 0
  }
  return (usedHours / availableHours) * 100
}

export function burnState(percent: number): BurnState {
  if (percent > 100) return 'overdrawn'
  if (percent > 90) return 'critical'
  if (percent >= 75) return 'warning'
  return 'healthy'
}

/**
 * Dashboard ordering: the projects in trouble first, and within a band the
 * ones furthest through their budget first.
 */
export function compareByUrgency(
  a: { state: BurnState; percentUsed: number },
  b: { state: BurnState; percentUsed: number },
): number {
  const byState = BURN_STATE_ORDER[a.state] - BURN_STATE_ORDER[b.state]
  if (byState !== 0) return byState
  return b.percentUsed - a.percentUsed
}

// ---------------------------------------------------------------------------
// Retainers
// ---------------------------------------------------------------------------

export interface RetainerPeriodInput {
  /** The period's own monthly allocation. */
  allocatedHours: number
  /** Unused hours carried in from the period before. */
  rolledInHours: number
  /** Time logged to this project inside the period window, in seconds. */
  usedSeconds: number
}

export interface RetainerBurn {
  type: 'retainer'
  /** Allocation plus rollover — the number that actually matters. */
  availableHours: number
  allocatedHours: number
  rolledInHours: number
  usedHours: number
  /** Negative once the retainer is overdrawn. */
  remainingHours: number
  percentUsed: number
  state: BurnState
}

/**
 * A retainer is scoped to its current period. Hours from previous periods are
 * already reflected in `rolledInHours`, not counted again here.
 */
export function calculateRetainerBurn(input: RetainerPeriodInput): RetainerBurn {
  const availableHours = input.allocatedHours + input.rolledInHours
  const usedHours = secondsToHours(input.usedSeconds)
  const remainingHours = availableHours - usedHours
  const percent = percentUsed(usedHours, availableHours)

  return {
    type: 'retainer',
    availableHours,
    allocatedHours: input.allocatedHours,
    rolledInHours: input.rolledInHours,
    usedHours,
    remainingHours,
    percentUsed: percent,
    state: burnState(percent),
  }
}

export interface RolloverInput {
  allocatedHours: number
  rolledInHours: number
  usedSeconds: number
  rolloverEnabled: boolean
  /** `null` means uncapped. */
  rolloverCapHours: number | null
}

/**
 * What a closing period hands to the next one.
 *
 * With rollover switched off the unused hours are simply forfeited. With it on
 * they carry forward, but never more than the cap, and an overdrawn period
 * carries nothing — the overrun is absorbed, not passed on as a debt.
 */
export function calculateRollover(input: RolloverInput): number {
  if (!input.rolloverEnabled) return 0

  const available = input.allocatedHours + input.rolledInHours
  const unused = available - secondsToHours(input.usedSeconds)
  if (unused <= 0) return 0

  if (input.rolloverCapHours === null) return unused
  return Math.min(unused, Math.max(0, input.rolloverCapHours))
}

export interface RetainerPeriodBounds {
  periodStart: IsoDate
  /** Inclusive. */
  periodEnd: IsoDate
}

export interface GeneratePeriodsInput {
  startDate: IsoDate
  billingDayOfMonth: number
  /** Generate every period that has begun on or before this date. */
  upTo: IsoDate
  /** The retainer's own end date, if it has one. */
  endDate?: IsoDate | null
}

/**
 * Every period boundary for a retainer, from its start date up to `upTo`.
 *
 * The first period runs from the start date to the day before the next billing
 * day, so a retainer that begins mid-cycle gets a short first period rather
 * than a misaligned run of dates forever after. Every period after that runs
 * billing day to billing day.
 *
 * Boundaries are always measured from the anchor month rather than by stepping
 * forward from the previous period, so a retainer billed on the 31st goes
 * 31 Jan → 28 Feb → 31 Mar, instead of getting stuck on the 28th.
 */
export function generateRetainerPeriods(input: GeneratePeriodsInput): RetainerPeriodBounds[] {
  const { startDate, billingDayOfMonth, upTo } = input
  if (billingDayOfMonth < 1 || billingDayOfMonth > 31) {
    throw new RangeError(`billingDayOfMonth must be 1-31, received ${billingDayOfMonth}`)
  }

  const hardEnd = input.endDate ?? null
  if (hardEnd !== null && compareIsoDates(hardEnd, startDate) < 0) return []
  if (compareIsoDates(startDate, upTo) > 0) return []

  const start = parseIsoDate(startDate)

  // The first billing day strictly after the start date anchors every
  // subsequent boundary.
  const sameMonthBilling = dayOfMonthIn(start.year, start.month, billingDayOfMonth)
  const anchor =
    compareIsoDates(sameMonthBilling, startDate) > 0
      ? { year: start.year, month: start.month }
      : { year: start.year, month: start.month + 1 }

  const boundaryAt = (offset: number): IsoDate =>
    dayOfMonthIn(anchor.year, anchor.month + offset, billingDayOfMonth)

  const periods: RetainerPeriodBounds[] = []
  let periodStart = startDate
  let offset = 0

  while (compareIsoDates(periodStart, upTo) <= 0) {
    if (hardEnd !== null && compareIsoDates(periodStart, hardEnd) > 0) break

    const nextBoundary = boundaryAt(offset)
    let periodEnd = addDays(nextBoundary, -1)
    if (hardEnd !== null && compareIsoDates(periodEnd, hardEnd) > 0) {
      periodEnd = hardEnd
    }

    periods.push({ periodStart, periodEnd })

    if (hardEnd !== null && compareIsoDates(periodEnd, hardEnd) >= 0) break

    periodStart = nextBoundary
    offset += 1
  }

  return periods
}

/** The period containing `date`, if the retainer was running then. */
export function findPeriodFor(
  periods: readonly RetainerPeriodBounds[],
  date: IsoDate,
): RetainerPeriodBounds | null {
  return (
    periods.find(
      (period) =>
        compareIsoDates(period.periodStart, date) <= 0 &&
        compareIsoDates(period.periodEnd, date) >= 0,
    ) ?? null
  )
}

/** Days left in the period. `0` means it ends today; negative means it has closed. */
export function daysRemainingInPeriod(periodEnd: IsoDate, today: IsoDate): number {
  return daysBetween(today, periodEnd)
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

export interface BundlePurchase {
  purchasedHours: number
  /** Only used to decide which threshold applies — the most recent one wins. */
  purchaseDate: IsoDate
  lowBalanceThresholdPct?: number
}

export interface BundleBurn {
  type: 'bundle'
  purchasedHours: number
  usedHours: number
  remainingHours: number
  percentUsed: number
  state: BurnState
  /** True once the balance has crossed the threshold for a top-up conversation. */
  topUpDue: boolean
  thresholdPct: number
}

const DEFAULT_LOW_BALANCE_THRESHOLD_PCT = 75

/**
 * A bundle is one finite pot measured over its whole life, not per month.
 * Top-ups add to the same pot, so the balance is every purchase ever made
 * minus every hour ever logged.
 */
export function calculateBundleBurn(
  purchases: readonly BundlePurchase[],
  usedSeconds: number,
): BundleBurn {
  const purchasedHours = purchases.reduce((total, purchase) => total + purchase.purchasedHours, 0)
  const usedHours = secondsToHours(usedSeconds)
  const remainingHours = purchasedHours - usedHours
  const percent = percentUsed(usedHours, purchasedHours)

  // The threshold travels with the most recent purchase — a top-up is the
  // moment to reset expectations about when to have the next conversation.
  const latest = [...purchases].sort((a, b) => compareIsoDates(a.purchaseDate, b.purchaseDate)).at(-1)
  const thresholdPct = latest?.lowBalanceThresholdPct ?? DEFAULT_LOW_BALANCE_THRESHOLD_PCT

  return {
    type: 'bundle',
    purchasedHours,
    usedHours,
    remainingHours,
    percentUsed: percent,
    state: burnState(percent),
    topUpDue: purchasedHours > 0 && percent >= thresholdPct,
    thresholdPct,
  }
}

// ---------------------------------------------------------------------------
// Standalone projects
// ---------------------------------------------------------------------------

export interface StandaloneInput {
  quotedHours: number
  fixedFee: number
  usedSeconds: number
}

export interface StandaloneBurn {
  type: 'standalone'
  quotedHours: number
  actualHours: number
  /** Quoted minus actual. Negative once the job has run past its quote. */
  varianceHours: number
  percentUsed: number
  state: BurnState
  fixedFee: number
  /** What the fee actually works out to per hour. `null` before any time is logged. */
  effectiveHourlyRate: number | null
}

/**
 * A standalone project is fixed-fee, so there is no balance to run down. The
 * question is margin: how the hours actually spent compare with the hours
 * quoted, and what that does to the effective rate.
 */
export function calculateStandaloneBurn(input: StandaloneInput): StandaloneBurn {
  const actualHours = secondsToHours(input.usedSeconds)
  const percent = percentUsed(actualHours, input.quotedHours)

  return {
    type: 'standalone',
    quotedHours: input.quotedHours,
    actualHours,
    varianceHours: input.quotedHours - actualHours,
    percentUsed: percent,
    state: burnState(percent),
    fixedFee: input.fixedFee,
    effectiveHourlyRate: actualHours > 0 ? input.fixedFee / actualHours : null,
  }
}

export type ProjectBurn = RetainerBurn | BundleBurn | StandaloneBurn

/** The headline figure for a project card, whatever its type. */
export function burnHeadline(burn: ProjectBurn): { used: string; available: string; label: string } {
  switch (burn.type) {
    case 'retainer':
      return {
        used: formatHours(burn.usedHours),
        available: formatHours(burn.availableHours),
        label: 'this period',
      }
    case 'bundle':
      return {
        used: formatHours(burn.usedHours),
        available: formatHours(burn.purchasedHours),
        label: 'of bundle',
      }
    case 'standalone':
      return {
        used: formatHours(burn.actualHours),
        available: formatHours(burn.quotedHours),
        label: 'of quote',
      }
  }
}
