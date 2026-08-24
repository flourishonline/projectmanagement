'use client'

import { useState } from 'react'
import { Field, Input, Select } from '@/components/ui'
import type { ProjectType } from '@/lib/db-types'

export interface TypeDefaults {
  monthly_hours?: number | string
  billing_day_of_month?: number | string
  rollover_enabled?: boolean
  rollover_cap_hours?: number | string | null
  start_date?: string
  end_date?: string | null
  purchased_hours?: number | string
  purchase_date?: string
  expiry_date?: string | null
  low_balance_threshold_pct?: number | string
  quoted_hours?: number | string
  fixed_fee?: number | string
  due_date?: string | null
}

/**
 * The three project types have genuinely different commercial shapes, so the
 * form changes rather than showing one long list of fields that mostly do not
 * apply.
 */
export function ProjectTypeFields({
  type,
  onTypeChange,
  defaults = {},
  lockType = false,
  today,
}: {
  type: ProjectType
  onTypeChange?: (type: ProjectType) => void
  defaults?: TypeDefaults
  lockType?: boolean
  today: string
}) {
  const [rollover, setRollover] = useState(defaults.rollover_enabled ?? false)

  return (
    <>
      {lockType ? (
        <input type="hidden" name="type" value={type} />
      ) : (
        <Field label="Type" hint="This decides how “hours remaining” is worked out, and cannot be changed later.">
          <Select
            name="type"
            value={type}
            onChange={(event) => onTypeChange?.(event.target.value as ProjectType)}
          >
            <option value="retainer">Retainer — a monthly allocation</option>
            <option value="bundle">Bundle — a finite pot of hours</option>
            <option value="standalone">Standalone — fixed fee</option>
          </Select>
        </Field>
      )}

      {type === 'retainer' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monthly hours">
            <Input
              name="monthly_hours"
              type="number"
              step="0.25"
              min="0.25"
              required
              defaultValue={defaults.monthly_hours ?? ''}
            />
          </Field>
          <Field label="Billing day of month" hint="Pulled back to the last day in shorter months.">
            <Input
              name="billing_day_of_month"
              type="number"
              min="1"
              max="31"
              required
              defaultValue={defaults.billing_day_of_month ?? 1}
            />
          </Field>
          <Field label="Start date">
            <Input name="start_date" type="date" required defaultValue={defaults.start_date ?? today} />
          </Field>
          <Field label="End date" hint="Leave blank for an open-ended retainer.">
            <Input name="end_date" type="date" defaultValue={defaults.end_date ?? ''} />
          </Field>

          <label className="flex items-center gap-2 self-end pb-1 text-sm text-ink-700">
            <input
              type="checkbox"
              name="rollover_enabled"
              checked={rollover}
              onChange={(event) => setRollover(event.target.checked)}
              className="size-4 rounded border-ink-300"
            />
            Unused hours roll over
          </label>

          {rollover ? (
            <Field label="Rollover cap (hours)" hint="Leave blank for no cap.">
              <Input
                name="rollover_cap_hours"
                type="number"
                step="0.25"
                min="0"
                defaultValue={defaults.rollover_cap_hours ?? ''}
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {type === 'bundle' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hours purchased">
            <Input
              name="purchased_hours"
              type="number"
              step="0.25"
              min="0.25"
              required
              defaultValue={defaults.purchased_hours ?? ''}
            />
          </Field>
          <Field label="Purchase date">
            <Input
              name="purchase_date"
              type="date"
              required
              defaultValue={defaults.purchase_date ?? today}
            />
          </Field>
          <Field label="Expiry date" hint="Optional.">
            <Input name="expiry_date" type="date" defaultValue={defaults.expiry_date ?? ''} />
          </Field>
          <Field label="Low balance threshold (%)" hint="When to start the top-up conversation.">
            <Input
              name="low_balance_threshold_pct"
              type="number"
              min="1"
              max="100"
              defaultValue={defaults.low_balance_threshold_pct ?? 75}
            />
          </Field>
        </div>
      ) : null}

      {type === 'standalone' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quoted hours">
            <Input
              name="quoted_hours"
              type="number"
              step="0.25"
              min="0.25"
              required
              defaultValue={defaults.quoted_hours ?? ''}
            />
          </Field>
          <Field label="Fixed fee (AUD)">
            <Input
              name="fixed_fee"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={defaults.fixed_fee ?? ''}
            />
          </Field>
          <Field label="Start date">
            <Input name="start_date" type="date" required defaultValue={defaults.start_date ?? today} />
          </Field>
          <Field label="Due date" hint="Optional.">
            <Input name="due_date" type="date" defaultValue={defaults.due_date ?? ''} />
          </Field>
        </div>
      ) : null}
    </>
  )
}
