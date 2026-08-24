/**
 * Pure timer rules. No database, no React — the parts that must behave the
 * same on the server, in the browser and under test.
 */

/** A timer left running this long is almost certainly forgotten, not worked. */
export const RUNAWAY_TIMER_SECONDS = 10 * 60 * 60

/**
 * A running timer must always end after it started. If someone stops a timer
 * in the same second they started it, one second is recorded rather than
 * letting the database reject the update and the entry be lost.
 */
export function safeEndTime(startedAt: string, now: Date = new Date()): string {
  const start = new Date(startedAt).getTime()
  return new Date(Math.max(now.getTime(), start + 1000)).toISOString()
}

export function elapsedSeconds(startedAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000))
}

export function isRunawayTimer(startedAt: string, now: Date = new Date()): boolean {
  return elapsedSeconds(startedAt, now) > RUNAWAY_TIMER_SECONDS
}
